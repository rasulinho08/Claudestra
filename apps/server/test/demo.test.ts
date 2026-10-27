import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Orchestrator } from "../src/orchestrator.ts";
import { RunStore } from "../src/store.ts";
import { testAgents, testConfig } from "./helpers.ts";

process.env.DEMO_SPEED = "200";
const { demoPlan, demoSession, requestOf } = await import("../src/demo.ts");

test("demo planner: questions go direct, build requests get coder + reviewer loop", () => {
  assert.equal(demoPlan("What is a calculator?", 6).route, "direct");
  const plan = demoPlan("make me a basic calculator", 6);
  assert.deepEqual(plan.steps.map((s) => s.agent), ["coder", "reviewer"]);
  assert.equal(plan.steps[1]?.loopBackTo, "s1");
  assert.equal(requestOf("x\n<request>\nhello\n</request>\ny"), "hello");
});

test("demo run: full team run completes with a fix loop and real files, $0", async () => {
  const workspacesDir = mkdtempSync(path.join(tmpdir(), "cls-demo-"));
  const store = new RunStore();
  const orch = new Orchestrator(testConfig({ workspacesDir }), store, testAgents(), { runSession: demoSession });
  store.create({ id: "d", prompt: "make me a basic calculator", source: "claudestra" });
  await orch.start("d", { prompt: "make me a basic calculator", profile: "balanced", approvalMode: "auto" });
  const events = store.events("d");
  assert.equal(store.status("d"), "completed");
  assert.deepEqual(events.filter((e) => e.type === "step.added").map((e) => e.stepId), ["s1-r2", "s2-r2"]);
  assert.ok(events.some((e) => e.type === "step.approved" && e.data.by === "auto"));
  assert.ok(existsSync(path.join(workspacesDir, "d", "basic-calculator.js")));
  const done = events.at(-1)!;
  assert.ok(done.type === "run.completed" && done.data.totalCostUsd === 0);
});
