import { test } from "node:test";
import assert from "node:assert/strict";
import { Orchestrator, type StartOptions } from "../src/orchestrator.ts";
import type { Config } from "../src/config.ts";
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
    const key = req.agent.info.id === "ceo" ? (req.outputSchema ? (req.task.startsWith("Review") ? "ceo:review" : "ceo:plan") : "ceo:final") : req.agent.info.id;
    const result = await (script[key] ?? (() => ({ text: `${key} done\n## Summary\n${key} summary` })))(req);
    const outcome: SessionOutcome = { ok: true, text: "", costUsd: 0.01, durationMs: 5, numTurns: 1, ...result };
    req.emit({ type: "usage.updated", data: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: outcome.costUsd } });
    req.emit(outcome.ok ? { type: "step.succeeded", data: { summary: outcome.text.slice(0, 50), costUsd: outcome.costUsd, durationMs: 5 } } : { type: "step.failed", data: { error: outcome.error ?? "x" } });
    return outcome;
  };
}

function setup(script: Record<string, Script>, configOver: Partial<Config> = {}) {
  const store = new RunStore(":memory:");
  const log: SessionRequest[] = [];
  const orch = new Orchestrator(testConfig(configOver), store, testAgents(), { runSession: fakeSessions(script, log) });
  store.create({ id: "r", prompt: "build it", source: "claudestra" });
  const start = (prompt = "build it", over: Partial<StartOptions> = {}) => orch.start("r", { prompt, profile: "balanced", approvalMode: "smart", ...over });
  return { store, orch, log, start };
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), "condition not reached");
};

const team = {
  route: "team",
  summary: "research, code, review",
  directAnswer: "",
  steps: [
    { id: "s1", agent: "researcher", task: "find", dependsOn: [], successCriteria: "", loopBackTo: "" },
    { id: "s2", agent: "coder", task: "write", dependsOn: ["s1"], successCriteria: "", loopBackTo: "" },
    { id: "s3", agent: "reviewer", task: "review", dependsOn: ["s2"], successCriteria: "", loopBackTo: "" },
  ],
};

test("team run: plan → steps in order with handoffs → CEO final answer", async () => {
  const { store, log, start } = setup({ "ceo:plan": () => ({ structured: team }), "ceo:final": () => ({ text: "All done." }) });
  await start();

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
  const { store, log, start } = setup({ "ceo:plan": () => ({ structured: { route: "direct", summary: "simple", directAnswer: "42", steps: [] } }) });
  await start("what is 6*7?");
  assert.equal(log.length, 1);
  const done = store.events("r").at(-1)!;
  assert.ok(done.type === "run.completed" && done.data.answer === "42");
});

test("single_agent route returns the agent report without a CEO final call", async () => {
  const { store, log, start } = setup({
    "ceo:plan": () => ({ structured: { route: "single_agent", summary: "one", directAnswer: "", steps: [{ id: "s1", agent: "researcher", task: "look", dependsOn: [], successCriteria: "" }] } }),
    researcher: () => ({ text: "Report body" }),
  });
  await start("find x");
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
      { id: "a", agent: "researcher", task: "a", dependsOn: [], successCriteria: "", loopBackTo: "" },
      { id: "b", agent: "researcher", task: "b", dependsOn: [], successCriteria: "", loopBackTo: "" },
      { id: "c", agent: "coder", task: "c", dependsOn: ["a", "b"], successCriteria: "", loopBackTo: "" },
      { id: "d", agent: "reviewer", task: "d", dependsOn: ["c"], successCriteria: "", loopBackTo: "" },
    ],
  };
  const { store, start } = setup({
    "ceo:plan": () => ({ structured: plan }),
    researcher: slow,
    coder: () => ({ ok: false, error: "boom" }),
    "ceo:review": () => ({ structured: { action: "finish", revisedTask: "", note: "stop here" } }),
    "ceo:final": () => ({ text: "partial" }),
  });
  await start("x");
  assert.equal(peak, 2);
  const skipped = store.events("r").filter((e) => e.type === "step.skipped").map((e) => e.stepId);
  assert.deepEqual(skipped, ["d"]);
  assert.ok(store.events("r").some((e) => e.type === "ceo.review" && e.data.action === "finish"));
  assert.equal(store.status("r"), "completed");
});

test("budget: steps that cannot be afforded are skipped and budget.exceeded is emitted", async () => {
  const { store, orch, start } = setup(
    { "ceo:plan": () => ({ structured: team, costUsd: 0.15 }), researcher: () => ({ text: "r", costUsd: 0.1 }), "ceo:final": () => ({ text: "f", costUsd: 0.01 }) },
    { profiles: { ...testConfig().profiles, balanced: { ...testConfig().profiles.balanced, budgetUsd: 0.3 } } },
  );
  await start("x");
  const types = store.events("r").map((e) => `${e.type}${e.stepId ? `:${e.stepId}` : ""}`);
  assert.ok(types.includes("budget.warning"));
  assert.ok(types.includes("budget.exceeded"));
  assert.ok(types.includes("step.skipped:s2"));
  assert.ok(types.includes("step.skipped:s3"));
  assert.equal(store.status("r"), "completed");
});

test("invalid plan fails the run with a clear error", async () => {
  const { store, orch, start } = setup({ "ceo:plan": () => ({ structured: { ...team, steps: [{ id: "s1", agent: "ghost", task: "t", dependsOn: [], successCriteria: "" }] } }) });
  await start("x");
  const last = store.events("r").at(-1)!;
  assert.ok(last.type === "run.failed" && /unknown agent "ghost"/.test(last.data.error));
});

test("cancel stops the run and nothing is recorded afterwards", async () => {
  let release!: () => void;
  const { store, orch, start } = setup({
    "ceo:plan": () => ({ structured: team }),
    researcher: (req) =>
      new Promise((resolve) => {
        release = () => resolve({ text: "late" });
        req.controller.signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }));
      }),
  });
  const run = start("x");
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

const coderOnly = { route: "team", summary: "c", directAnswer: "", steps: [{ id: "s1", agent: "coder", task: "write", dependsOn: [], successCriteria: "", loopBackTo: "" }] };

test("smart mode: risky Bash asks; approve, approve-for-run and reject are recorded", async () => {
  const results: string[] = [];
  const { store, orch, start } = setup({
    "ceo:plan": () => ({ structured: coderOnly }),
    coder: async (req) => {
      results.push(String((await req.authorize("Bash", { command: "ls -la" })).allow));
      results.push(String((await req.authorize("Bash", { command: "curl https://x" })).allow));
      results.push(String((await req.authorize("Bash", { command: "curl https://y" })).allow));
      results.push(String((await req.authorize("Bash", { command: "rm -rf build" })).allow));
      return { text: "done" };
    },
  });
  const run = start("x");
  const decideNext = async (decision: "approve" | "approve_run" | "reject") => {
    let id = "";
    await waitFor(() => {
      const pending = store.events("r").filter((e) => e.type === "step.approval_requested");
      const decided = new Set(store.events("r").flatMap((e) => (e.type === "step.approved" || e.type === "step.rejected" ? [e.data.approvalId] : [])));
      const open = pending.find((e) => e.type === "step.approval_requested" && !decided.has(e.data.approvalId));
      if (open?.type === "step.approval_requested") id = open.data.approvalId;
      return Boolean(id);
    });
    assert.equal(orch.decide("r", id, decision, "no"), true);
  };
  await decideNext("approve_run"); // curl https://x → approved for the run
  await decideNext("reject"); // rm -rf is never auto-approved, even with a run rule for Bash
  await run;
  assert.deepEqual(results, ["true", "true", "true", "false"]);
  const approved = store.events("r").filter((e) => e.type === "step.approved").map((e) => (e.type === "step.approved" ? `${e.data.by}:${e.data.scope}` : ""));
  assert.deepEqual(approved, ["user:run", "rule:once"]);
  assert.equal(store.status("r"), "completed");
});

test("auto mode approves gated calls without asking but logs them; neverAuto still asks", async () => {
  const results: boolean[] = [];
  const { store, orch, start } = setup({
    "ceo:plan": () => ({ structured: coderOnly }),
    coder: async (req) => {
      results.push((await req.authorize("Bash", { command: "npm install left-pad" })).allow);
      results.push((await req.authorize("Bash", { command: "git push origin main" })).allow);
      results.push((await req.authorize("Write", { file_path: "/etc/passwd" })).allow);
      return { text: "done" };
    },
  });
  const run = start("x", { approvalMode: "auto" });
  await waitFor(() => store.events("r").some((e) => e.type === "step.approval_requested"));
  const req = store.events("r").find((e) => e.type === "step.approval_requested")!;
  assert.ok(req.type === "step.approval_requested" && req.data.tool === "Bash");
  orch.decide("r", (req as { data: { approvalId: string } }).data.approvalId, "reject", "");
  await run;
  assert.deepEqual(results, [true, false, false]);
  assert.ok(store.events("r").some((e) => e.type === "step.approved" && e.data.by === "auto"));
  assert.ok(store.events("r").some((e) => e.type === "tool.denied"));
});

test("manual mode: the plan waits for approval; rejecting fails the run", async () => {
  const { store, orch, log, start } = setup({ "ceo:plan": () => ({ structured: team }) });
  const run = start("x", { approvalMode: "manual" });
  await waitFor(() => store.events("r").some((e) => e.type === "plan.approval_requested"));
  const ev = store.events("r").find((e) => e.type === "plan.approval_requested")!;
  orch.decide("r", (ev as { data: { approvalId: string } }).data.approvalId, "reject", "too big");
  await run;
  assert.equal(log.length, 1);
  const last = store.events("r").at(-1)!;
  assert.ok(last.type === "run.failed" && /too big/.test(last.data.error));
});

test("pause holds new steps until resume", async () => {
  let release!: () => void;
  const { store, orch, log, start } = setup({
    "ceo:plan": () => ({ structured: team }),
    researcher: () => new Promise((resolve) => (release = () => resolve({ text: "r" }))),
    "ceo:final": () => ({ text: "ok" }),
  });
  const run = start();
  await waitFor(() => log.some((r) => r.agent.info.id === "researcher"));
  orch.pause("r");
  release();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(log.at(-1)?.agent.info.id, "researcher");
  assert.ok(store.events("r").some((e) => e.type === "run.paused"));
  orch.resume("r");
  await run;
  assert.equal(store.status("r"), "completed");
  assert.ok(store.events("r").some((e) => e.type === "run.resumed"));
});

test("a failed step is retried once when the CEO review says retry", async () => {
  let calls = 0;
  const { store, log, start } = setup({
    "ceo:plan": () => ({ structured: coderOnly }),
    coder: () => (++calls === 1 ? { ok: false, error: "flaky" } : { text: "fixed" }),
    "ceo:review": () => ({ structured: { action: "retry", revisedTask: "write, carefully", note: "try again" } }),
    "ceo:final": () => ({ text: "done" }),
  });
  await start("x");
  assert.equal(calls, 2);
  assert.equal(log.filter((r) => r.agent.info.id === "coder").at(-1)?.task, "write, carefully");
  const retry = store.events("r").find((e) => e.type === "step.retrying");
  assert.ok(retry?.type === "step.retrying" && retry.data.attempt === 2);
  assert.equal(store.status("r"), "completed");
});

test("verifier loop: CHANGES REQUESTED sends the coder back until APPROVE", async () => {
  let reviews = 0;
  const plan = {
    route: "team", summary: "c+r", directAnswer: "",
    steps: [
      { id: "s1", agent: "coder", task: "write", dependsOn: [], successCriteria: "", loopBackTo: "" },
      { id: "s2", agent: "reviewer", task: "review", dependsOn: ["s1"], successCriteria: "", loopBackTo: "s1" },
    ],
  };
  const { store, start } = setup({
    "ceo:plan": () => ({ structured: plan }),
    reviewer: () => ({ text: ++reviews === 1 ? "VERDICT: CHANGES REQUESTED\n- fix the bug" : "VERDICT: APPROVE" }),
    "ceo:final": () => ({ text: "shipped" }),
  });
  await start("x");
  const added = store.events("r").filter((e) => e.type === "step.added").map((e) => e.stepId);
  assert.deepEqual(added, ["s1-r2", "s2-r2"]);
  const started = store.events("r").filter((e) => e.type === "step.started").map((e) => e.stepId);
  assert.deepEqual(started, ["ceo", "s1", "s2", "s1-r2", "s2-r2", "final"]);
  assert.equal(store.status("r"), "completed");
});

test("profile picks the models; eco caps the plan size", async () => {
  const big = { ...team, steps: [...team.steps, { id: "s4", agent: "doc-writer", task: "doc", dependsOn: ["s3"], successCriteria: "", loopBackTo: "" }] };
  const { store, start } = setup({ "ceo:plan": () => ({ structured: big }) });
  await start("x", { profile: "eco" });
  const last = store.events("r").at(-1)!;
  assert.ok(last.type === "run.failed" && /cap is 3/.test(last.data.error));

  const s2 = setup({ "ceo:plan": () => ({ structured: coderOnly }), "ceo:final": () => ({ text: "ok" }) });
  await s2.start("x", { profile: "max" });
  assert.equal(s2.log.find((r) => r.agent.info.id === "coder")?.model, "m-max");
});

test("workflow plan skips CEO planning", async () => {
  const { store, log, start } = setup({ "ceo:final": () => ({ text: "wf done" }) });
  await start("x", { plan: { route: "team", summary: "wf", steps: coderOnly.steps } });
  assert.deepEqual(log.map((r) => r.agent.info.id), ["coder", "ceo"]);
  assert.equal(store.status("r"), "completed");
});
