// Missions (docs/17): the heartbeat chains runs, carries files forward, and stops for the right reasons.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RunStore } from "../src/store.ts";
import { MissionInput, MissionRunner, Missions, missionFile, tickBrief } from "../src/missions.ts";
import type { RunRequest } from "../src/runs.ts";
import { requiredRole } from "../src/access.ts";

function setup(over: Partial<{ fail: () => boolean }> = {}) {
  const store = new RunStore();
  const missions = new Missions(store);
  const workspacesDir = mkdtempSync(path.join(tmpdir(), "missions-"));
  const requests: (RunRequest & { runId: string })[] = [];
  const start = (req: RunRequest) => {
    if (over.fail?.()) throw new Error("Daily budget of $5 reached");
    const runId = `run-${requests.length + 1}`;
    store.create({ id: runId, prompt: req.prompt, source: "claudestra", origin: req.origin });
    store.append(runId, { type: "run.started", data: { prompt: req.prompt, source: "claudestra", authMode: "demo", budgetUsd: 1, agents: [] } } as never);
    requests.push({ ...req, runId });
    return { runId };
  };
  const runner = new MissionRunner({ missions, store, workspacesDir, start });
  const finish = (runId: string, cost = 0.1, board?: string) => {
    if (board !== undefined) {
      mkdirSync(path.join(workspacesDir, runId, "mission"), { recursive: true });
      writeFileSync(path.join(workspacesDir, runId, "mission", "board.md"), board);
    }
    store.append(runId, { type: "run.completed", data: { answer: "ok", totalCostUsd: cost, durationMs: 1, numTurns: 1 } });
  };
  const fail = (runId: string) => store.append(runId, { type: "run.failed", data: { error: "boom" } });
  return { store, missions, runner, requests, finish, fail, workspacesDir };
}

const input = (over: Record<string, unknown> = {}) => MissionInput.parse({ goal: "Research the GRC market and write a weekly report", intervalMinutes: 60, days: 7, ...over });
const T0 = new Date("2026-11-10T08:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

test("a mission runs tick after tick, continuing from the previous tick's files", () => {
  const { missions, runner, requests, finish } = setup();
  const m = missions.create(input(), "aysel", T0);
  assert.equal(m.status, "active");
  assert.deepEqual(runner.tick(T0), ["run-1"]);
  assert.deepEqual(runner.tick(at(1)), [], "one tick at a time");
  assert.equal(requests[0]!.seedFrom, undefined);
  assert.equal(requests[0]!.origin, `mission:${m.id}`);
  assert.match(requests[0]!.history!, /first session: create mission\/board\.md/);

  finish("run-1", 0.25, "# Board\n## Todo\n- task 2\n");
  assert.deepEqual(runner.tick(at(10)), [], "waits for the interval");
  let now = missions.get(m.id)!;
  assert.equal(now.currentRunId, null);
  assert.equal(now.lastRunId, "run-1");
  assert.equal(now.spentUsd, 0.25);
  assert.equal(now.nextTickAt, at(70).toISOString());

  assert.deepEqual(runner.tick(at(70)), ["run-2"]);
  assert.equal(requests[1]!.seedFrom, "run-1");
  assert.match(requests[1]!.history!, /Read mission\/board\.md and mission\/journal\.md first/);
  now = missions.get(m.id)!;
  assert.equal(now.ticks, 2);
  assert.deepEqual(missions.runs(m.id).map((r) => r.tick), [2, 1]);
});

test("a mission ends when the board says done, at its deadline, or at its budget", () => {
  const a = setup();
  const done = a.missions.create(input(), null, T0);
  a.runner.tick(T0);
  a.finish("run-1", 0.1, "MISSION STATUS: DONE\n# Board\n");
  a.runner.tick(at(5));
  assert.equal(a.missions.get(done.id)!.status, "done");
  assert.deepEqual(a.runner.tick(at(500)), []);

  const b = setup();
  const budget = b.missions.create(input({ budgetUsd: 0.5 }), null, T0);
  b.runner.tick(T0);
  b.finish("run-1", 0.6, "# Board\n");
  b.runner.tick(at(5));
  assert.equal(b.missions.get(budget.id)!.status, "stopped");
  assert.match(b.missions.get(budget.id)!.lastError!, /budget of \$0\.5/);

  const c = setup();
  const late = c.missions.create(input({ days: 1 }), null, T0);
  c.runner.tick(T0);
  c.finish("run-1");
  c.runner.tick(at(24 * 60 + 1));
  assert.equal(c.missions.get(late.id)!.status, "stopped");
});

test("failed ticks keep the last good files; three in a row stop the mission; limits only delay it", () => {
  const { missions, runner, requests, finish, fail } = setup();
  const m = missions.create(input(), null, T0);
  runner.tick(T0);
  finish("run-1");
  runner.tick(T0);
  runner.tick(at(60));
  fail("run-2");
  runner.tick(at(61));
  assert.equal(missions.get(m.id)!.lastRunId, "run-1");
  assert.equal(missions.get(m.id)!.failures, 1);
  runner.tick(at(121));
  assert.equal(requests[2]!.seedFrom, "run-1", "continues from the last good tick");
  fail("run-3");
  runner.tick(at(122));
  runner.tick(at(182));
  fail("run-4");
  runner.tick(at(183));
  assert.equal(missions.get(m.id)!.status, "failed");

  let blocked = true;
  const s = setup({ fail: () => blocked });
  const waiting = s.missions.create(input(), null, T0);
  assert.deepEqual(s.runner.tick(T0), []);
  const after = s.missions.get(waiting.id)!;
  assert.equal(after.status, "active", "a usage or budget limit does not fail the mission");
  assert.match(after.lastError!, /Daily budget/);
  assert.equal(after.nextTickAt, at(30).toISOString());
  blocked = false;
  assert.equal(s.runner.tick(at(30)).length, 1);
});

test("paused missions do not tick; the brief carries the owner's note; files are read safely", () => {
  const { missions, runner, workspacesDir, finish } = setup();
  const m = missions.create(input(), null, T0);
  missions.set(m.id, { status: "paused", note: "Focus on Azerbaijan first" });
  assert.deepEqual(runner.tick(T0), []);
  assert.match(tickBrief(missions.get(m.id)!, 3, T0), /Focus on Azerbaijan first/);
  missions.set(m.id, { status: "active" });
  runner.tick(T0);
  finish("run-1", 0, "# Board\n- a\n");
  assert.equal(missionFile(workspacesDir, "run-1", "board.md"), "# Board\n- a\n");
  assert.equal(missionFile(workspacesDir, "../etc", "board.md"), "");
  assert.equal(missionFile(workspacesDir, "run-1", "journal.md"), "");
});

test("operators may manage missions", () => {
  assert.equal(requiredRole("POST", "/api/missions"), "operator");
  assert.equal(requiredRole("POST", "/api/missions/abc/pause"), "operator");
});
