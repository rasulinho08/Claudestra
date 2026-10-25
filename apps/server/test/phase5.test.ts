import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp, type RunStarter } from "../src/app.ts";
import { RunStore } from "../src/store.ts";
import { SkillLibrary } from "../src/skills.ts";
import { IntegrationRegistry } from "../src/integrations.ts";
import { WorkflowStore } from "../src/workflows.ts";
import { Memory, keywords, similarity } from "../src/memory.ts";
import { Access, requiredRole } from "../src/access.ts";
import { nextRun, parseCron } from "../src/cron.ts";
import { Scheduler, TriggerStore, paramsFromPayload } from "../src/triggers.ts";
import { Evals, score } from "../src/evals.ts";
import { RunLauncher } from "../src/runs.ts";
import { Orchestrator, buildStepPrompt } from "../src/orchestrator.ts";
import type { SessionRequest } from "../src/session.ts";
import type { Config } from "../src/config.ts";
import { testAgents, testConfig } from "./helpers.ts";

// A runner that finishes every run instantly with a fixed answer (and writes a file for eval checks).
function instantRunner(store: RunStore, cfg: Config, answer = "Tokyo is the capital"): RunStarter & { starts: string[] } {
  const starts: string[] = [];
  return {
    starts,
    async start(runId, opts) {
      starts.push(opts.prompt);
      const ws = path.join(cfg.workspacesDir, runId);
      mkdirSync(ws, { recursive: true });
      writeFileSync(path.join(ws, "add.js"), "export const add = (a, b) => a + b;\n");
      store.append(runId, { type: "plan.created", data: { plan: { route: "direct", summary: "", steps: [] } } });
      store.append(runId, { type: "step.started", data: { task: "t", model: "m", tools: [] } }, { stepId: "ceo", agentId: "ceo" });
      store.append(runId, { type: "run.completed", data: { answer, totalCostUsd: 0.01, durationMs: 1, numTurns: 1 } });
    },
    cancel: () => false, pause: () => false, resume: () => false, decide: () => false,
  };
}

function setup(over: Partial<Config> = {}, access?: (s: RunStore) => Access) {
  const cfg = testConfig({ workspacesDir: mkdtempSync(path.join(tmpdir(), "cls-")), ...over });
  const store = new RunStore();
  const runner = instantRunner(store, cfg);
  const workflows = new WorkflowStore(store);
  const app = createApp({ config: cfg, store, agents: testAgents(), runner, skills: new SkillLibrary(cfg.skillsDir), integrations: new IntegrationRegistry(cfg.integrationsFile, {}), workflows, access: access?.(store), templatesDir: cfg.templatesDir });
  const req = (method: string, url: string, b?: unknown, headers: Record<string, string> = {}) =>
    app.request(url, { method, body: b === undefined ? undefined : typeof b === "string" ? b : JSON.stringify(b), headers: { "content-type": "application/json", ...headers } });
  return { cfg, store, runner, workflows, app, req };
}

test("memory: notes go to every step, related runs are recalled, unrelated are not", () => {
  const store = new RunStore();
  const memory = new Memory(store);
  memory.addNote("Our stack is React and Node");
  memory.remember("r1", "Build a todo app in React", "Created todo app with React hooks");
  memory.remember("r2", "Write a poem about the sea", "A poem");
  assert.ok(similarity(keywords("react todo list"), keywords("Build a todo app in React")) > 0.5);
  assert.deepEqual(memory.recall("Add dark mode to the React todo app").map((r) => r.runId), ["r1"]);
  assert.deepEqual(memory.recall("Explain quantum physics"), []);
  assert.match(memory.notesBlock(), /React and Node/);
  assert.match(buildStepPrompt("req", { id: "s1", task: "t" }, [], memory.notesBlock()), /^# Company notes/);
  memory.forget("r1");
  assert.equal(memory.recall("React todo").length, 0);
});

test("memory reaches the CEO planning prompt and the run is remembered", async () => {
  const store = new RunStore();
  const memory = new Memory(store);
  memory.addNote("Always answer in Azerbaijani");
  const prompts: string[] = [];
  const runSession = async (req: SessionRequest) => {
    prompts.push(req.prompt);
    return { ok: true, text: "", structured: { route: "direct", summary: "s", directAnswer: "Bakı", steps: [] }, costUsd: 0.01, durationMs: 1, numTurns: 1 };
  };
  const orch = new Orchestrator(testConfig(), store, testAgents(), { runSession, memory });
  store.create({ id: "r", prompt: "capital?", source: "claudestra" });
  await orch.start("r", { prompt: "capital?", profile: "balanced", approvalMode: "smart" });
  assert.match(prompts[0]!, /Always answer in Azerbaijani/);
  assert.ok(store.events("r").some((e) => e.type === "memory.recalled"));
  assert.equal(memory.runs()[0]?.summary, "Bakı");
});

test("access: off by default, then login, roles and cookies", async () => {
  assert.equal(requiredRole("GET", "/api/agents"), "viewer");
  assert.equal(requiredRole("POST", "/api/runs/x/approvals/y"), "operator");
  assert.equal(requiredRole("PUT", "/api/agents/coder"), "owner");

  const open = setup();
  assert.equal((await open.req("GET", "/api/agents")).status, 200);

  let acc!: Access;
  const locked = setup({}, (s) => (acc = new Access(s, "owner-secret")));
  const viewer = acc.addUser("vera", "viewer").token;
  assert.equal((await locked.req("GET", "/api/agents")).status, 401);
  assert.equal((await locked.req("GET", "/api/health")).status, 200);
  assert.equal((await locked.req("POST", "/api/login", { token: "nope" })).status, 401);
  const login = await locked.req("POST", "/api/login", { token: viewer });
  assert.match(login.headers.get("set-cookie") ?? "", /claudestra_token=.*HttpOnly/);
  assert.equal((await locked.req("GET", "/api/agents", undefined, { cookie: `claudestra_token=${viewer}` })).status, 200);
  assert.equal((await locked.req("POST", "/api/runs", { prompt: "x" }, { authorization: `Bearer ${viewer}` })).status, 403);
  assert.equal((await locked.req("POST", "/api/runs", { prompt: "x" }, { authorization: "Bearer owner-secret" })).status, 201);
  const session = (await (await locked.req("GET", "/api/session", undefined, { authorization: `Bearer ${viewer}` })).json()) as { user: { role: string } };
  assert.equal(session.user.role, "viewer");
  assert.equal((await locked.req("POST", "/hooks/SessionStart", { session_id: "z" })).status, 200); // loopback in tests
});

test("cron parsing and next run", () => {
  const m = parseCron("*/15 9-17 * * 1-5");
  assert.ok(m(new Date(2026, 9, 26, 9, 30))); // Monday
  assert.ok(!m(new Date(2026, 9, 25, 9, 30))); // Sunday
  assert.ok(!m(new Date(2026, 9, 26, 9, 31)));
  assert.equal(nextRun("0 8 * * *", new Date(2026, 9, 26, 7, 59))?.getHours(), 8);
  assert.throws(() => parseCron("61 * * * *"));
  assert.throws(() => parseCron("* * *"));
});

test("triggers: schedule fires once per minute, webhook secret and GitHub signature are checked", async () => {
  const { req, runner, store } = setup();
  const wf = (await (await req("POST", "/api/workflows", { fromTemplate: "research-report" })).json()) as { id: string; params: { key: string }[] };
  assert.deepEqual(wf.params.map((p) => p.key), ["prompt", "angle"]);

  const sched = (await (await req("POST", "/api/triggers", { workflowId: wf.id, kind: "schedule", cron: "0 8 * * *", params: { prompt: "AI news" } })).json()) as { id: string };
  assert.ok(sched.id);
  assert.equal((await req("POST", "/api/triggers", { workflowId: wf.id, kind: "schedule", cron: "bad" })).status, 400);
  const triggers = new TriggerStore(store);
  const fired: string[] = [];
  const s = new Scheduler(triggers, (t, p) => (fired.push(p.prompt!), "run-x"));
  s.tick(new Date(2026, 9, 26, 8, 0, 5));
  s.tick(new Date(2026, 9, 26, 8, 0, 40));
  s.tick(new Date(2026, 9, 26, 8, 1, 0));
  assert.deepEqual(fired, ["AI news"]);

  const hook = (await (await req("POST", "/api/triggers", { workflowId: wf.id, kind: "webhook", params: { angle: "costs" } })).json()) as { id: string; secret: string };
  assert.equal((await req("POST", `/api/triggers/${hook.id}/fire`, { prompt: "x" })).status, 401);
  const ok = await req("POST", `/api/triggers/${hook.id}/fire?secret=${hook.secret}`, { prompt: "Compare Vite and Webpack" });
  assert.equal(ok.status, 202);
  assert.equal(runner.starts.at(-1), "Compare Vite and Webpack");

  const gh = JSON.stringify({ action: "opened", repository: { full_name: "o/r" }, issue: { title: "Crash on start", body: "Steps…", html_url: "https://github.com/o/r/issues/1" }, sender: { login: "u" } });
  const sig = `sha256=${createHmac("sha256", hook.secret).update(gh).digest("hex")}`;
  const res = await req("POST", `/api/triggers/${hook.id}/fire`, gh, { "x-github-event": "issues", "x-hub-signature-256": sig });
  assert.equal(res.status, 202);
  assert.match(runner.starts.at(-1)!, /GitHub issues \(opened\) in o\/r: Crash on start/);
  assert.equal((await req("POST", `/api/triggers/${hook.id}/fire`, gh, { "x-github-event": "issues", "x-hub-signature-256": "sha256=bad" })).status, 401);
  assert.equal(paramsFromPayload({ a: 1, nested: { x: 1 } }).a, "1");
});

test("evals: checks are scored and a suite runs to completion", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cls-evals-"));
  writeFileSync(path.join(dir, "mini.json"), JSON.stringify({
    name: "mini", cases: [
      { id: "a", prompt: "capital of Japan?", checks: [{ type: "route", equals: "direct" }, { type: "answer_contains", value: "tokyo" }, { type: "max_cost", usd: 0.05 }] },
      { id: "b", prompt: "make add.js", checks: [{ type: "file_contains", path: "add.js", value: "add" }, { type: "agents_include", agents: ["coder"] }] },
    ],
  }));
  const cfg = testConfig({ workspacesDir: mkdtempSync(path.join(tmpdir(), "cls-")) });
  const store = new RunStore();
  const launcher = new RunLauncher(cfg, store, testAgents(), new WorkflowStore(store), instantRunner(store, cfg));
  const evals = new Evals(dir, store, launcher, cfg.workspacesDir);
  assert.equal(evals.suites()[0]?.cases.length, 2);
  const id = evals.start("mini");
  for (let i = 0; i < 100 && evals.history()[0]?.status !== "done"; i++) await new Promise((r) => setTimeout(r, 10));
  const run = evals.history().find((h) => h.id === id)!;
  assert.equal(run.status, "done");
  assert.equal(run.passed, 1);
  assert.equal(run.results[1]?.checks.find((c) => c.check === "agents_include")?.passed, false);
  assert.equal(score({ type: "status", equals: "completed" }, { status: "completed", answer: "", route: null, costUsd: 0, steps: 0, agents: [], workspace: dir }).passed, true);
});

test("templates are listed, imported, exported with positions", async () => {
  const { req } = setup();
  const tpls = (await (await req("GET", "/api/templates")).json()) as { id: string }[];
  assert.ok(tpls.length >= 5);
  const wf = (await (await req("POST", "/api/workflows", { fromTemplate: "bug-fix" })).json()) as { id: string; steps: unknown[]; name: string };
  const upd = await req("PUT", `/api/workflows/${wf.id}`, { name: wf.name, steps: wf.steps, positions: { repro: { x: 10, y: 20 } } });
  assert.equal(upd.status, 200);
  const exp = (await (await req("GET", `/api/workflows/${wf.id}/export`)).json()) as { positions: Record<string, { x: number }> };
  assert.equal(exp.positions.repro?.x, 10);
  assert.equal((await req("POST", "/api/workflows", { name: "bad", steps: [{ id: "s1", agent: "ghost", task: "t" }] })).status, 400);
});
