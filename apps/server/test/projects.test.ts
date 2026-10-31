import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, type RunStarter } from "../src/app.ts";
import { RunStore } from "../src/store.ts";
import { SkillLibrary } from "../src/skills.ts";
import { IntegrationRegistry } from "../src/integrations.ts";
import { WorkflowStore } from "../src/workflows.ts";
import { Projects, checkExternalFolder } from "../src/projects.ts";
import { testAgents, testConfig } from "./helpers.ts";

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), "cls-proj-"));
  const config = testConfig({ workspacesDir: path.join(root, "ws"), projectsDir: path.join(root, "projects"), snapshotsDir: path.join(root, "snaps") });
  const store = new RunStore();
  const started: { runId: string; projectNote?: string }[] = [];
  const runner: RunStarter = {
    async start(runId, opts) {
      started.push({ runId, projectNote: opts.projectNote });
      store.append(runId, { type: "run.completed", data: { answer: "ok", totalCostUsd: 0, durationMs: 1, numTurns: 1 } });
    },
    cancel: () => false,
    pause: () => false,
    resume: () => false,
    decide: () => false,
  };
  const app = createApp({ config, store, agents: testAgents(), runner, skills: new SkillLibrary(config.skillsDir), integrations: new IntegrationRegistry(config.integrationsFile, {}), workflows: new WorkflowStore(store) });
  const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
  const post = (url: string, body: unknown) => app.request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { root, config, store, app, started, json, post };
}

test("project runs: copy in, list changes, apply with snapshot, undo, conflicts", async () => {
  const { root, config, app, started, json, post } = setup();
  try {
    // A real folder on the PC, linked as a project.
    const real = path.join(root, "my-site");
    mkdirSync(path.join(real, "node_modules", "x"), { recursive: true });
    writeFileSync(path.join(real, "index.html"), "<h1>v1</h1>");
    writeFileSync(path.join(real, "old.txt"), "old");
    writeFileSync(path.join(real, "keep.txt"), "keep");
    writeFileSync(path.join(real, "node_modules", "x", "big.js"), "skip me");
    const created = await post("/api/projects", { name: "Sayt", folder: real });
    assert.equal(created.status, 201);
    const project = (await created.json()) as { id: string; path: string };
    assert.equal(project.path, real);

    const res = await post("/api/runs", { prompt: "Başlığı dəyiş", projectId: project.id });
    assert.equal(res.status, 201);
    const { runId } = (await res.json()) as { runId: string };
    const ws = path.join(config.workspacesDir, runId);
    assert.equal(readFileSync(path.join(ws, "index.html"), "utf8"), "<h1>v1</h1>");
    assert.equal(existsSync(path.join(ws, "node_modules")), false, "node_modules is not copied");
    assert.match(started[0]!.projectNote!, /continues the project "Sayt"/);
    assert.match(started[0]!.projectNote!, /- index\.html/);

    // The "agents" change files in the workspace.
    writeFileSync(path.join(ws, "index.html"), "<h1>v2</h1>");
    writeFileSync(path.join(ws, "new.css"), "body{}");
    unlinkSync(path.join(ws, "old.txt"));
    writeFileSync(path.join(ws, "keep.txt"), "changed in run");
    // Meanwhile the owner edits keep.txt in the real folder: conflict.
    writeFileSync(path.join(real, "keep.txt"), "owner edit");

    const ch = await json<{ changes: { path: string; kind: string; conflict: boolean; before?: string; after?: string }[] }>(app.request(`/api/runs/${runId}/changes`));
    assert.deepEqual(
      ch.changes.map((c) => [c.path, c.kind, c.conflict]),
      [
        ["index.html", "modified", false],
        ["keep.txt", "modified", true],
        ["new.css", "added", false],
        ["old.txt", "deleted", false],
      ],
    );
    assert.equal(ch.changes[0]!.before, "<h1>v1</h1>");
    assert.equal(ch.changes[0]!.after, "<h1>v2</h1>");

    const applied = await json<{ applied: string[]; skipped: { path: string }[] }>(post(`/api/runs/${runId}/apply`, {}));
    assert.deepEqual(applied.applied, ["index.html", "new.css", "old.txt"]);
    assert.deepEqual(applied.skipped.map((s) => s.path), ["keep.txt"]);
    assert.equal(readFileSync(path.join(real, "index.html"), "utf8"), "<h1>v2</h1>");
    assert.equal(readFileSync(path.join(real, "keep.txt"), "utf8"), "owner edit", "conflict not overwritten");
    assert.equal(existsSync(path.join(real, "old.txt")), false);
    assert.equal((await post(`/api/runs/${runId}/apply`, {})).status, 409, "no double apply");

    const undone = await json<{ restored: number }>(post(`/api/runs/${runId}/undo-apply`, {}));
    assert.equal(undone.restored, 3);
    assert.equal(readFileSync(path.join(real, "index.html"), "utf8"), "<h1>v1</h1>");
    assert.equal(readFileSync(path.join(real, "old.txt"), "utf8"), "old");
    assert.equal(existsSync(path.join(real, "new.css")), false);

    const detail = await json<{ runs: { runId: string; appliedAt: string | null; undoneAt: string | null }[]; files: { path: string }[] }>(app.request(`/api/projects/${project.id}`));
    assert.equal(detail.runs[0]!.runId, runId);
    assert.ok(detail.runs[0]!.undoneAt);
    assert.ok(!detail.files.some((f) => f.path.startsWith("node_modules")));

    // A managed project starts empty; the next run sees the earlier task in its note.
    const managed = await json<{ id: string; path: string }>(post("/api/projects", { name: "Boş" }));
    assert.ok(managed.path.startsWith(config.projectsDir));
    const r1 = await json<{ runId: string }>(post("/api/runs", { prompt: "first", projectId: managed.id }));
    writeFileSync(path.join(config.workspacesDir, r1.runId, "a.txt"), "A");
    await post(`/api/runs/${r1.runId}/apply`, {});
    assert.equal(readFileSync(path.join(managed.path, "a.txt"), "utf8"), "A");
    await post("/api/runs", { prompt: "second", projectId: managed.id });
    assert.match(started[2]!.projectNote!, /Earlier tasks in this project[\s\S]*- first \(applied\)/);
    assert.match(started[2]!.projectNote!, /- a\.txt/);

    assert.equal((await post("/api/runs", { prompt: "x", projectId: "nope" })).status, 404);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("linked folders: refuse drive roots, home, system folders and Claudestra's own data", () => {
  const own = mkdtempSync(path.join(os.tmpdir(), "cls-own-"));
  try {
    assert.throws(() => checkExternalFolder(path.parse(process.cwd()).root, []), /drive/);
    assert.throws(() => checkExternalFolder(os.homedir(), []), /home/);
    assert.throws(() => checkExternalFolder("relative/path", []), /full path/);
    assert.throws(() => checkExternalFolder(path.join(own, "missing"), []), /not an existing folder/);
    assert.throws(() => checkExternalFolder(own, [path.join(own, "workspaces")]), /Claudestra/);
    if (process.platform !== "win32") assert.throws(() => checkExternalFolder("/etc", []), /system/);
    mkdirSync(path.join(own, "site"));
    assert.doesNotThrow(() => checkExternalFolder(path.join(own, "site"), [path.join(own, "workspaces")]));
  } finally {
    rmSync(own, { recursive: true, force: true });
  }
});

test("HQ: approvals waiting, busy agents, recent runs, spend", async () => {
  const { root, store, app, json } = setup();
  try {
    store.create({ id: "run-a", prompt: "Build a site", source: "claudestra" });
    store.append("run-a", { type: "step.started", data: { task: "code it", model: "m", tools: [] } }, { stepId: "s1", agentId: "coder" });
    store.recordApproval({ id: "ap1", runId: "run-a", stepId: "s1", kind: "tool", request: { tool: "Bash", input: { command: "npm install" }, reason: "outside the safe list" } });
    const hq = await json<{ approvals: { approvalId: string; agentId: string; tool: string }[]; team: { id: string; busy: { runId: string } | null }[]; running: { id: string }[]; recent: unknown[]; spend: { today: number } }>(app.request("/api/hq"));
    assert.deepEqual(hq.approvals.map((a) => [a.approvalId, a.agentId, a.tool]), [["ap1", "coder", "Bash"]]);
    assert.equal(hq.team.find((a) => a.id === "coder")!.busy!.runId, "run-a");
    assert.equal(hq.team.find((a) => a.id === "tester")!.busy, null);
    assert.deepEqual(hq.running.map((r) => r.id), ["run-a"]);
    assert.equal(hq.spend.today, 0);
    store.decideApproval("ap1", "approve", "user", "");
    assert.equal((await json<{ approvals: unknown[] }>(app.request("/api/hq"))).approvals.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safeTarget: no writes through links or onto folders in a real project", async () => {
  const { safeTarget } = await import("../src/projects.ts");
  const { symlinkSync } = await import("node:fs");
  const root = mkdtempSync(path.join(os.tmpdir(), "cls-safe-"));
  try {
    const proj = path.join(root, "proj");
    const outside = path.join(root, "outside");
    mkdirSync(path.join(proj, "sub"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(outside, "secret.txt"), "x");
    symlinkSync(outside, path.join(proj, "link"), process.platform === "win32" ? "junction" : "dir");
    symlinkSync(path.join(outside, "secret.txt"), path.join(proj, "file-link"));
    assert.equal(safeTarget(proj, "sub/a.txt"), path.join(proj, "sub/a.txt"));
    assert.equal(safeTarget(proj, "new/deep/a.txt"), path.join(proj, "new/deep/a.txt"));
    assert.equal(safeTarget(proj, "link/secret.txt"), null);
    assert.equal(safeTarget(proj, "link/new/x.txt"), null);
    assert.equal(safeTarget(proj, "file-link"), null);
    assert.equal(safeTarget(proj, "sub"), null);
    assert.equal(safeTarget(proj, "../outside/secret.txt"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("review fixes: baseline lives in the DB, protected paths, no false deletions, undo keeps later edits", async () => {
  const { root, config, app, json, post } = setup();
  try {
    const real = path.join(root, "site");
    mkdirSync(real);
    writeFileSync(path.join(real, "a.txt"), "A1");
    writeFileSync(path.join(real, "b.txt"), "B1");
    const project = await json<{ id: string }>(post("/api/projects", { name: "P", folder: real }));
    const other = await json<{ id: string; path: string }>(post("/api/projects", { name: "Other" }));
    const { runId } = await json<{ runId: string }>(post("/api/runs", { prompt: "x", projectId: project.id }));
    const ws = path.join(config.workspacesDir, runId);

    // An agent forging a baseline file in the workspace changes nothing: the project comes from the DB.
    mkdirSync(path.join(ws, ".claudestra"), { recursive: true });
    writeFileSync(path.join(ws, ".claudestra", "baseline.json"), JSON.stringify({ projectId: other.id, files: {} }));
    // Protected folders in any case are never changes.
    mkdirSync(path.join(ws, ".Git"), { recursive: true });
    writeFileSync(path.join(ws, ".Git", "config"), "evil");
    writeFileSync(path.join(ws, "a.txt"), "A2");

    const ch = await json<{ changes: { path: string; kind: string }[] }>(app.request(`/api/runs/${runId}/changes`));
    assert.deepEqual(ch.changes.map((c) => `${c.kind}:${c.path}`), ["modified:a.txt"]);

    const r = await json<{ applied: string[] }>(post(`/api/runs/${runId}/apply`, {}));
    assert.deepEqual(r.applied, ["a.txt"]);
    assert.equal(existsSync(path.join(other.path, "a.txt")), false, "nothing written into another project");
    assert.equal(existsSync(path.join(real, ".Git")), false);
    // After applying, the applied file is not a "conflict".
    const after = await json<{ changes: { path: string; conflict: boolean }[] }>(app.request(`/api/runs/${runId}/changes`));
    assert.equal(after.changes.find((c) => c.path === "a.txt")!.conflict, false);

    // The owner edits a.txt again: undo leaves it alone unless forced.
    writeFileSync(path.join(real, "a.txt"), "A3 owner");
    const u1 = await json<{ restored: number; skipped: string[] }>(post(`/api/runs/${runId}/undo-apply`, {}));
    assert.deepEqual(u1.skipped, ["a.txt"]);
    assert.equal(readFileSync(path.join(real, "a.txt"), "utf8"), "A3 owner");
    const u2 = await json<{ restored: number; skipped: string[] }>(post(`/api/runs/${runId}/undo-apply`, { force: true }));
    assert.equal(u2.restored, 1);
    assert.equal(readFileSync(path.join(real, "a.txt"), "utf8"), "A1");

    // Too many files in the workspace: refuse instead of reporting everything else as deleted.
    const { runId: big } = await json<{ runId: string }>(post("/api/runs", { prompt: "big", projectId: project.id }));
    const bigWs = path.join(config.workspacesDir, big);
    mkdirSync(path.join(bigWs, "aaa"));
    for (let i = 0; i < 5001; i++) writeFileSync(path.join(bigWs, "aaa", `f${i}`), "");
    assert.equal((await app.request(`/api/runs/${big}/changes`)).status, 409);
    assert.equal((await post(`/api/runs/${big}/apply`, {})).status, 409);
    assert.equal(readFileSync(path.join(real, "b.txt"), "utf8"), "B1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("protectedPath catches case and Windows trailing-dot variants", async () => {
  const { protectedPath } = await import("../src/projects.ts");
  for (const p of [".git/config", ".Git./hooks/x", "a/NODE_MODULES/b.js", ".Claude/settings.json", ".claudestra /x"]) assert.equal(protectedPath(p), true, p);
  for (const p of ["src/app.js", "git.txt", "docs/.github/x.yml"]) assert.equal(protectedPath(p), false, p);
});
