import { test } from "node:test";
import assert from "node:assert/strict";
import { Orchestrator } from "../src/orchestrator.ts";
import { RunStore } from "../src/store.ts";
import type { SessionRequest, SessionRunner } from "../src/session.ts";
import type { SessionOutcome } from "../src/sdk-mapper.ts";
import { extractSummary, validatePlan } from "../src/plan.ts";
import { testAgents, testConfig } from "./helpers.ts";

type Script = (req: SessionRequest) => Partial<SessionOutcome> | Promise<Partial<SessionOutcome>>;

// Fake SDK: emits a minimal event sequence and returns scripted outcomes per agent.
function fakeSessions(script: Record<string, Script>, log: SessionRequest[] = []): SessionRunner {
  return async (req) => {
    log.push(req);
    req.emit({ type: "step.started", data: { task: req.task, model: req.model, tools: req.agent.tools } });
    const key = req.agent.info.id === "ceo" ? (req.outputSchema ? "ceo:plan" : "ceo:final") : req.agent.info.id;
    const result = await (script[key] ?? (() => ({ text: `${key} done\n## Summary\n${key} summary` })))(req);
    const outcome: SessionOutcome = { ok: true, text: "", costUsd: 0.01, durationMs: 5, numTurns: 1, ...result };
    req.emit({ type: "usage.updated", data: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: outcome.costUsd } });
    req.emit(outcome.ok ? { type: "step.succeeded", data: { summary: outcome.text.slice(0, 50), costUsd: outcome.costUsd, durationMs: 5 } } : { type: "step.failed", data: { error: outcome.error ?? "x" } });
    return outcome;
  };
}

function setup(script: Record<string, Script>, configOver = {}) {
  const store = new RunStore(":memory:");
  const log: SessionRequest[] = [];
  const orch = new Orchestrator(testConfig(configOver), store, testAgents(), fakeSessions(script, log));
  store.create({ id: "r", prompt: "build it", source: "claudestra" });
  return { store, orch, log };
}

const team = {
  route: "team",
  summary: "research, code, review",
  directAnswer: "",
  steps: [
    { id: "s1", agent: "researcher", task: "find", dependsOn: [], successCriteria: "" },
    { id: "s2", agent: "coder", task: "write", dependsOn: ["s1"], successCriteria: "" },
    { id: "s3", agent: "reviewer", task: "review", dependsOn: ["s2"], successCriteria: "" },
  ],
};

test("team run: plan → steps in order with handoffs → CEO final answer", async () => {
  const { store, orch, log } = setup({ "ceo:plan": () => ({ structured: team }), "ceo:final": () => ({ text: "All done." }) });
  await orch.start("r", "build it");

  const events = store.events("r");
  const started = events.filter((e) => e.type === "step.started").map((e) => e.stepId);
  assert.deepEqual(started, ["ceo", "s1", "s2", "s3", "final"]);
  const handoffs = events.filter((e) => e.type === "step.handoff").map((e) => (e.type === "step.handoff" ? `${e.data.from}->${e.data.to}` : ""));
  assert.deepEqual(handoffs, ["s1->s2", "s2->s3"]);
  assert.equal(events.filter((e) => e.type === "artifact.created").length, 3);

  const done = events.at(-1)!;
  assert.equal(done.type, "run.completed");
  if (done.type === "run.completed") {
    assert.equal(done.data.answer, "All done.");
    assert.equal(done.data.totalCostUsd, 0.05);
  }
  // Downstream prompt carries the upstream summary, not the whole report.
  const coderPrompt = log.find((r) => r.agent.info.id === "coder")!.prompt;
  assert.match(coderPrompt, /researcher summary/);
  assert.match(coderPrompt, /Full report: \.claudestra\/reports\/s1-researcher\.md/);
  // Models come from the agent's class.
  assert.equal(log.find((r) => r.agent.info.id === "researcher")!.model, "m-mid");
  assert.equal(store.list()[0]?.costUsd, 0.05);
});

test("direct route answers with the CEO only", async () => {
  const { store, orch, log } = setup({ "ceo:plan": () => ({ structured: { route: "direct", summary: "simple", directAnswer: "42", steps: [] } }) });
  await orch.start("r", "what is 6*7?");
  assert.equal(log.length, 1);
  const done = store.events("r").at(-1)!;
  assert.ok(done.type === "run.completed" && done.data.answer === "42");
});

test("single_agent route returns the agent report without a CEO final call", async () => {
  const { store, orch, log } = setup({
    "ceo:plan": () => ({ structured: { route: "single_agent", summary: "one", directAnswer: "", steps: [{ id: "s1", agent: "researcher", task: "look", dependsOn: [], successCriteria: "" }] } }),
    researcher: () => ({ text: "Report body" }),
  });
  await orch.start("r", "find x");
  assert.deepEqual(log.map((r) => r.agent.info.id), ["ceo", "researcher"]);
  const done = store.events("r").at(-1)!;
  assert.ok(done.type === "run.completed" && done.data.answer === "Report body");
});

test("parallel steps run together; a failed step skips its dependents", async () => {
  let concurrent = 0;
  let peak = 0;
  const slow: Script = async () => {
    concurrent++;
    peak = Math.max(peak, concurrent);
    await new Promise((r) => setTimeout(r, 20));
    concurrent--;
    return { text: "ok" };
  };
  const plan = {
    route: "team", summary: "p", directAnswer: "",
    steps: [
      { id: "a", agent: "researcher", task: "a", dependsOn: [], successCriteria: "" },
      { id: "b", agent: "researcher", task: "b", dependsOn: [], successCriteria: "" },
      { id: "c", agent: "coder", task: "c", dependsOn: ["a", "b"], successCriteria: "" },
      { id: "d", agent: "reviewer", task: "d", dependsOn: ["c"], successCriteria: "" },
    ],
  };
  const { store, orch } = setup({ "ceo:plan": () => ({ structured: plan }), researcher: slow, coder: () => ({ ok: false, error: "boom" }), "ceo:final": () => ({ text: "partial" }) });
  await orch.start("r", "x");
  assert.equal(peak, 2);
  const skipped = store.events("r").filter((e) => e.type === "step.skipped").map((e) => e.stepId);
  assert.deepEqual(skipped, ["d"]);
  assert.equal(store.status("r"), "completed");
});

test("budget: steps that cannot be afforded are skipped and budget.exceeded is emitted", async () => {
  const { store, orch } = setup(
    { "ceo:plan": () => ({ structured: team, costUsd: 0.15 }), researcher: () => ({ text: "r", costUsd: 0.1 }), "ceo:final": () => ({ text: "f", costUsd: 0.01 }) },
    { runBudgetUsd: 0.3 },
  );
  await orch.start("r", "x");
  const types = store.events("r").map((e) => `${e.type}${e.stepId ? `:${e.stepId}` : ""}`);
  assert.ok(types.includes("budget.warning"));
  assert.ok(types.includes("budget.exceeded"));
  assert.ok(types.includes("step.skipped:s2"));
  assert.ok(types.includes("step.skipped:s3"));
  assert.equal(store.status("r"), "completed");
});

test("invalid plan fails the run with a clear error", async () => {
  const { store, orch } = setup({ "ceo:plan": () => ({ structured: { ...team, steps: [{ id: "s1", agent: "ghost", task: "t", dependsOn: [], successCriteria: "" }] } }) });
  await orch.start("r", "x");
  const last = store.events("r").at(-1)!;
  assert.ok(last.type === "run.failed" && /unknown agent "ghost"/.test(last.data.error));
});

test("cancel stops the run and nothing is recorded afterwards", async () => {
  let release!: () => void;
  const { store, orch } = setup({
    "ceo:plan": () => ({ structured: team }),
    researcher: (req) =>
      new Promise((resolve) => {
        release = () => resolve({ text: "late" });
        req.controller.signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }));
      }),
  });
  const run = orch.start("r", "x");
  while (!store.events("r").some((e) => e.type === "step.started" && e.stepId === "s1")) await new Promise((r) => setTimeout(r, 5));
  assert.equal(orch.cancel("r"), true);
  await run;
  release?.();
  assert.equal(store.status("r"), "cancelled");
  assert.equal(store.events("r").at(-1)?.type, "run.cancelled");
});

test("validatePlan rejects cycles, reserved ids, oversize plans", () => {
  const roster = testAgents().specialists();
  const step = (id: string, deps: string[] = []) => ({ id, agent: "coder", task: "t", dependsOn: deps, successCriteria: "" });
  assert.throws(() => validatePlan({ route: "team", summary: "", directAnswer: "", steps: [step("a", ["b"]), step("b", ["a"])] }, roster, 6), /cycle/);
  assert.throws(() => validatePlan({ route: "team", summary: "", directAnswer: "", steps: [step("ceo")] }, roster, 6), /reserved/);
  assert.throws(() => validatePlan({ route: "team", summary: "", directAnswer: "", steps: [step("a"), step("b")] }, roster, 1), /cap/);
  assert.throws(() => validatePlan({ route: "direct", summary: "", directAnswer: " ", steps: [] }, roster, 6), /without an answer/);
});

test("extractSummary prefers the Summary section", () => {
  assert.equal(extractSummary("long body\n## Summary\nshort"), "short");
  assert.equal(extractSummary("no heading"), "no heading");
});
