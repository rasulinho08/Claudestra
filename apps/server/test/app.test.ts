import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type RunStarter, type Services } from "../src/app.ts";
import { RunStore } from "../src/store.ts";
import { SkillLibrary } from "../src/skills.ts";
import { IntegrationRegistry } from "../src/integrations.ts";
import { WorkflowStore } from "../src/workflows.ts";
import type { Config } from "../src/config.ts";
import { testAgents, testConfig } from "./helpers.ts";

const config = testConfig();

function services(store: RunStore, runner: RunStarter, cfg: Config = config): Services {
  return { config: cfg, store, agents: testAgents(), runner, skills: new SkillLibrary(cfg.skillsDir), integrations: new IntegrationRegistry(cfg.integrationsFile, {}), workflows: new WorkflowStore(store) };
}

function fakeRunner(store: RunStore): RunStarter {
  return {
    async start(runId) {
      store.append(runId, { type: "step.message", data: { messageId: "m1", text: "hi", partial: false, role: "assistant" } });
      store.append(runId, { type: "run.completed", data: { answer: "hi", totalCostUsd: 0, durationMs: 1, numTurns: 1 } });
    },
    cancel: () => false,
    pause: () => false,
    resume: () => false,
    decide: () => false,
  };
}

async function readEvents(res: Response, count: number): Promise<{ id: string; data: { type: string; seq: number } }[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: { id: string; data: { type: string; seq: number } }[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const id = /^id: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (id && data) events.push({ id, data: JSON.parse(data) });
    }
  }
  await reader.cancel();
  return events;
}

test("POST /api/runs then SSE replays all events in order, and resumes after Last-Event-ID", async () => {
  const store = new RunStore();
  const app = createApp(services(store, fakeRunner(store)));

  assert.equal((await app.request("/api/runs", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status, 400);

  const res = await app.request("/api/runs", { method: "POST", body: JSON.stringify({ prompt: "hello" }), headers: { "content-type": "application/json" } });
  assert.equal(res.status, 201);
  const { runId } = (await res.json()) as { runId: string };

  const all = await readEvents(await app.request(`/api/runs/${runId}/events`), 3);
  assert.deepEqual(all.map((e) => e.data.type), ["run.started", "step.message", "run.completed"]);

  const resumed = await readEvents(await app.request(`/api/runs/${runId}/events`, { headers: { "Last-Event-ID": "2" } }), 1);
  assert.deepEqual(resumed.map((e) => e.data.seq), [3]);
});

test("observer hooks create a run per Claude Code session", async () => {
  const store = new RunStore();
  const app = createApp(services(store, fakeRunner(store), { ...config, authMode: "observer" }));
  const post = (event: string, body: object) =>
    app.request(`/hooks/${event}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  await post("SessionStart", { session_id: "abc", cwd: "/proj" });
  await post("PreToolUse", { session_id: "abc", tool_name: "Read", tool_use_id: "t1", tool_input: {} });
  await post("PostToolUse", { session_id: "abc", tool_name: "Read", tool_use_id: "t1", tool_response: "ok" });

  const types = store.events("obs-abc").map((e) => e.type);
  assert.deepEqual(types, ["run.started", "step.started", "step.message", "tool.called", "tool.result"]);

  const health = (await (await app.request("/api/health")).json()) as { canStartRuns: boolean };
  assert.equal(health.canStartRuns, false);
  const blocked = await app.request("/api/runs", { method: "POST", body: JSON.stringify({ prompt: "x" }), headers: { "content-type": "application/json" } });
  assert.equal(blocked.status, 409);
});

test("workflows: save from a run, run with params, versions on update", async () => {
  const store = new RunStore();
  const started: { prompt: string; plan?: unknown }[] = [];
  const runner: RunStarter = {
    async start(_id, opts) {
      started.push(opts);
    },
    cancel: () => false, pause: () => false, resume: () => false, decide: () => false,
  };
  const app = createApp(services(store, runner));
  const json = (method: string, url: string, b?: unknown) =>
    app.request(url, { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { "content-type": "application/json" } });

  store.create({ id: "r0", prompt: "build a todo app", source: "claudestra" });
  store.append("r0", { type: "run.started", data: { prompt: "build a todo app", source: "claudestra", authMode: "api_key", budgetUsd: 1, agents: [] } });
  store.append("r0", { type: "plan.created", data: { plan: { route: "team", summary: "s", steps: [{ id: "s1", agent: "coder", task: "Implement: build a todo app", dependsOn: [], successCriteria: "", loopBackTo: "" }] } } });

  const created = (await (await json("POST", "/api/workflows", { fromRunId: "r0", name: "App builder" })).json()) as { id: string; steps: { task: string }[]; version: number };
  assert.equal(created.steps[0]?.task, "Implement: {{prompt}}");
  assert.equal(created.version, 1);

  const res = await json("POST", "/api/runs", { workflowId: created.id, params: { prompt: "build a notes app" } });
  assert.equal(res.status, 201);
  assert.equal(started[0]?.prompt, "build a notes app");
  assert.match(JSON.stringify(started[0]?.plan), /Implement: build a notes app/);

  const updated = (await (await json("PUT", `/api/workflows/${created.id}`, { name: "App builder 2", steps: created.steps })).json()) as { version: number };
  assert.equal(updated.version, 2);
  const detail = (await (await json("GET", `/api/workflows/${created.id}`)).json()) as { versions: unknown[] };
  assert.equal(detail.versions.length, 2);
});

test("daily budget cap blocks new runs", async () => {
  const store = new RunStore();
  const app = createApp(services(store, fakeRunner(store), { ...config, dailyBudgetUsd: 0.1 }));
  store.create({ id: "old", prompt: "p", source: "claudestra" });
  store.append("old", { type: "run.completed", data: { answer: "", totalCostUsd: 0.2, durationMs: 1, numTurns: 1 } });
  const res = await app.request("/api/runs", { method: "POST", body: JSON.stringify({ prompt: "x" }), headers: { "content-type": "application/json" } });
  assert.equal(res.status, 429);
});

test("agents, skills, integrations and analytics endpoints respond", async () => {
  const store = new RunStore();
  const app = createApp(services(store, fakeRunner(store)));
  const agents = (await (await app.request("/api/agents")).json()) as { id: string }[];
  assert.equal(agents.length, 11);
  const skills = (await (await app.request("/api/skills")).json()) as { name: string; usedBy: string[] }[];
  assert.ok(skills.find((s) => s.name === "clean-code")?.usedBy.includes("coder"));
  const integ = (await (await app.request("/api/integrations")).json()) as { servers: { id: string; status: string }[] };
  assert.equal(integ.servers.find((s) => s.id === "github")?.status, "missing_secret");
  const stats = (await (await app.request("/api/analytics")).json()) as { totals: { runs: number } };
  assert.equal(stats.totals.runs, 0);
});
