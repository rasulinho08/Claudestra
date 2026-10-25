import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClaudestraEvent, EventData } from "@claudestra/protocol";
import { emptyRun, reduceRun } from "../src/run-state.ts";
import { Director, FINISH, HQ, buildRoad, layoutFor, pointAt, stopPositions, toolLine, worldHeightFor } from "../src/stage/world.ts";

let seq = 0;
const ev = (data: EventData, stepId?: string, agentId?: string) => ({ ...data, seq: ++seq, runId: "r", ts: new Date(seq * 1000).toISOString(), stepId, agentId }) as ClaudestraEvent;
const info = () => ({ name: "A", color: "#123456", icon: "bot" });
const plan = {
  route: "team" as const,
  summary: "s",
  steps: [
    { id: "s1", agent: "coder", task: "c", dependsOn: [], successCriteria: "", loopBackTo: "" },
    { id: "s2", agent: "reviewer", task: "r", dependsOn: ["s1"], successCriteria: "", loopBackTo: "s1" },
  ],
};

test("layout: HQ first, finish last, stops inside the world, road passes through them", () => {
  seq = 0;
  const run = [
    ev({ type: "run.started", data: { prompt: "p", source: "claudestra", authMode: "api_key", budgetUsd: 1, agents: [] } }),
    ev({ type: "plan.created", data: { plan } }),
    ev({ type: "step.added", data: { id: "s1-r2", agent: "coder", task: "fix", dependsOn: ["s2"], loopOf: "s1", iteration: 2 } }, "s1-r2", "coder"),
  ].reduce(reduceRun, emptyRun());
  const layout = layoutFor(run, info, 720);
  assert.deepEqual(layout.stations.map((s) => s.key), [HQ, "s1", "s2", FINISH]);
  for (const s of layout.stations) assert.ok(s.pos.x > 0 && s.pos.x < 1280 && s.pos.y > 0 && s.pos.y < 720);
  const dists = layout.stations.map((s) => s.dist);
  assert.deepEqual([...dists].sort((a, b) => a - b), dists);
  const mid = pointAt(layout.road, layout.road.length / 2);
  assert.ok(Number.isFinite(mid.x) && Number.isFinite(mid.angle));
  assert.equal(stopPositions(12, 900).length, 12);
  assert.equal(buildRoad([{ x: 1, y: 1 }]).length, 0);
  assert.ok(worldHeightFor(800, 800) > worldHeightFor(1600, 800));
});

test("director: handoffs become carry trips, new steps visits, completion goes to the finish", () => {
  seq = 0;
  let run = [
    ev({ type: "run.started", data: { prompt: "p", source: "claudestra", authMode: "api_key", budgetUsd: 1, agents: [] } }),
    ev({ type: "step.started", data: { task: "Plan", model: "m", tools: [] } }, "ceo", "ceo"),
  ].reduce(reduceRun, emptyRun());
  const d = new Director();
  assert.equal(d.sync(run, () => "#fff"), HQ);
  run = [
    ev({ type: "plan.created", data: { plan } }),
    ev({ type: "step.started", data: { task: "c", model: "m", tools: [] } }, "s1", "coder"),
    ev({ type: "step.handoff", data: { from: "s1", to: "s2", summary: "x" } }, "s2", "reviewer"),
    ev({ type: "step.started", data: { task: "r", model: "m", tools: [] } }, "s2", "reviewer"),
  ].reduce(reduceRun, run);
  d.sync(run, () => "#fff");
  assert.ok(d.queue.some((t) => t.kind === "carry" && t.to === "s2"));
  assert.ok(d.queue.some((t) => t.kind === "visit" && t.to === "s1"));
  run = reduceRun(run, ev({ type: "run.completed", data: { answer: "a", totalCostUsd: 0.1, durationMs: 1, numTurns: 1 } }));
  d.sync(run, () => "#fff");
  assert.equal(d.queue.at(-1)?.to, FINISH);
  assert.ok(d.celebrate);
  assert.equal(toolLine("mcp__github__search_code"), "asking github");
  assert.equal(toolLine(undefined), "thinking…");
});

test("director joining a finished run starts at the finish without replaying history", () => {
  seq = 0;
  const run = [
    ev({ type: "run.started", data: { prompt: "p", source: "claudestra", authMode: "api_key", budgetUsd: 1, agents: [] } }),
    ev({ type: "plan.created", data: { plan } }),
    ev({ type: "step.handoff", data: { from: "s1", to: "s2", summary: "x" } }, "s2", "reviewer"),
    ev({ type: "run.completed", data: { answer: "a", totalCostUsd: 0.1, durationMs: 1, numTurns: 1 } }),
  ].reduce(reduceRun, emptyRun());
  const d = new Director();
  assert.equal(d.sync(run, () => "#fff"), FINISH);
  assert.equal(d.queue.length, 0);
});
