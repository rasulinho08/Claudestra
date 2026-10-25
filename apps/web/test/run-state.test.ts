import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClaudestraEvent, EventData } from "@claudestra/protocol";
import { activeStep, emptyRun, reduceRun, totalUsage } from "../src/run-state.ts";
import { buildGraph } from "../src/graph.ts";

let seq = 0;
const ev = (data: EventData, stepId?: string, agentId?: string) =>
  ({ ...data, seq: ++seq, runId: "r", ts: new Date(seq * 1000).toISOString(), stepId, agentId }) as ClaudestraEvent;

const plan = {
  route: "team" as const,
  summary: "s",
  steps: [
    { id: "s1", agent: "researcher", task: "find", dependsOn: [], successCriteria: "" },
    { id: "s2", agent: "coder", task: "build", dependsOn: ["s1"], successCriteria: "" },
  ],
};

function play(events: ClaudestraEvent[]) {
  return events.reduce(reduceRun, emptyRun());
}

test("plan creates pending nodes plus the CEO final node; graph wires CEO → s1 → s2 → final", () => {
  seq = 0;
  const run = play([
    ev({ type: "run.started", data: { prompt: "p", source: "claudestra", authMode: "api_key", budgetUsd: 1, agents: [] } }),
    ev({ type: "step.started", data: { task: "Plan", model: "m", tools: [] } }, "ceo", "ceo"),
    ev({ type: "plan.created", data: { plan } }),
  ]);
  assert.deepEqual(run.order, ["ceo", "s1", "s2", "final"]);
  assert.equal(run.steps.s1?.status, "pending");
  const { edges } = buildGraph(run, null);
  assert.deepEqual(edges.map((e) => e.id), ["ceo->s1", "s1->s2", "s2->final"]);
});

test("streamed deltas are replaced by the final text; usage and cost tracked per step and run", () => {
  seq = 0;
  const run = play([
    ev({ type: "run.started", data: { prompt: "p", source: "claudestra", authMode: "api_key", budgetUsd: 1, agents: [] } }),
    ev({ type: "step.started", data: { task: "t", model: "m", tools: [] } }, "s1", "researcher"),
    ev({ type: "step.message", data: { messageId: "m1", text: "Hel", partial: true } }, "s1"),
    ev({ type: "step.message", data: { messageId: "m1", text: "lo", partial: true } }, "s1"),
    ev({ type: "step.message", data: { messageId: "m1", text: "Hello!", partial: false } }, "s1"),
    ev({ type: "usage.updated", data: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.02, runCostUsd: 0.05 } }, "s1"),
  ]);
  const msg = run.steps.s1!.items[0]!;
  assert.ok(msg.kind === "message" && msg.text === "Hello!" && !msg.streaming);
  assert.equal(run.steps.s1!.costUsd, 0.02);
  assert.equal(run.costUsd, 0.05);
  assert.equal(totalUsage(run).outputTokens, 7);
  assert.equal(activeStep(run), "s1");
});

test("cancel closes running and pending steps; old seqs are ignored", () => {
  seq = 0;
  const started = ev({ type: "run.started", data: { prompt: "p", source: "claudestra", authMode: "api_key", budgetUsd: 1, agents: [] } });
  let run = play([
    started,
    ev({ type: "plan.created", data: { plan } }),
    ev({ type: "step.started", data: { task: "t", model: "m", tools: [] } }, "s1", "researcher"),
    ev({ type: "run.cancelled", data: { by: "user" } }),
  ]);
  assert.equal(run.steps.s1?.status, "cancelled");
  assert.equal(run.steps.s2?.status, "cancelled");
  assert.equal(run.status, "cancelled");
  assert.equal(reduceRun(run, started), run);
});
