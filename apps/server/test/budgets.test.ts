// Per-agent monthly budgets (docs/18).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RunStore } from "../src/store.ts";
import { AgentBudgets } from "../src/budgets.ts";
import { Orchestrator } from "../src/orchestrator.ts";
import { demoSession } from "../src/demo.ts";
import { requiredRole } from "../src/access.ts";
import { testAgents, testConfig } from "./helpers.ts";

function spend(store: RunStore, runId: string, agentId: string, usd: number, startedAt?: string) {
  store.create({ id: runId, prompt: "p", source: "claudestra" });
  if (startedAt) store.database.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(startedAt, runId);
  store.database.prepare("INSERT INTO steps (run_id, step_id, agent_id, task, status, cost_usd) VALUES (?, 's1', ?, 't', 'succeeded', ?)").run(runId, agentId, usd);
}

test("budget status counts this month's spend only", () => {
  const store = new RunStore();
  const budgets = new AgentBudgets(store);
  assert.deepEqual(budgets.status("coder"), { monthlyUsd: null, spentUsd: 0, over: false });
  spend(store, "r1", "coder", 1.5);
  spend(store, "r0", "coder", 50, "2020-01-05T00:00:00.000Z");
  spend(store, "r2", "researcher", 9);
  budgets.set("coder", 2);
  assert.deepEqual(budgets.status("coder"), { monthlyUsd: 2, spentUsd: 1.5, over: false });
  assert.equal(budgets.refusal("coder", "Coder"), null);
  spend(store, "r3", "coder", 0.5);
  assert.equal(budgets.status("coder").over, true);
  assert.match(budgets.refusal("coder", "Fateh")!, /Fateh has used its monthly budget \(\$2\.00 of \$2\)/);
  budgets.set("coder", 0);
  assert.equal(budgets.status("coder").monthlyUsd, null, "0 clears the cap");
});

test("an agent over its budget fails its step without calling the model", async () => {
  const store = new RunStore();
  const budgets = new AgentBudgets(store);
  spend(store, "old", "researcher", 3);
  budgets.set("researcher", 1);
  let calls = 0;
  const workspacesDir = mkdtempSync(path.join(tmpdir(), "budget-"));
  const orch = new Orchestrator(testConfig({ workspacesDir }), store, testAgents(), {
    budgets,
    runSession: (req) => {
      if (req.agent.info.id === "researcher") calls++;
      return demoSession(req);
    },
  });
  store.create({ id: "run", prompt: "research this", source: "claudestra" });
  store.append("run", { type: "run.started", data: { prompt: "research this", source: "claudestra", authMode: "demo", budgetUsd: 2, agents: [] } } as never);
  await orch.start("run", {
    prompt: "research this",
    profile: "balanced",
    approvalMode: "auto",
    plan: { route: "single_agent", summary: "direct", steps: [{ id: "s1", agent: "researcher", task: "research this", dependsOn: [], successCriteria: "", loopBackTo: "" }] },
  });
  for (let i = 0; i < 200 && store.status("run") === "running"; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 0, "no model call for the capped agent");
  const failed = store.events("run").find((e) => e.type === "step.failed");
  assert.match((failed!.data as { error: string }).error, /monthly budget/);
});

test("only the owner sets budgets", () => {
  assert.equal(requiredRole("PUT", "/api/agents/coder/budget"), "owner");
});
