// Per-agent monthly budgets (docs/18): the owner may cap what one agent spends in a calendar month. When the cap is
// reached the agent's next steps fail at once with a clear message, without calling the model; other agents go on.
// This sits on top of the per-run, per-step, daily and monthly limits (docs/11), it never loosens them.
import type { RunStore } from "./store.ts";
import { startOfMonth } from "./analytics.ts";

export type BudgetStatus = { monthlyUsd: number | null; spentUsd: number; over: boolean };

export class AgentBudgets {
  constructor(private store: RunStore) {
    this.store.database.exec("CREATE TABLE IF NOT EXISTS agent_budgets (agent_id TEXT PRIMARY KEY, monthly_usd REAL NOT NULL)");
  }

  limit(agentId: string): number | null {
    const row = this.store.database.prepare("SELECT monthly_usd FROM agent_budgets WHERE agent_id = ?").get(agentId) as { monthly_usd: number } | undefined;
    return row ? row.monthly_usd : null;
  }

  // null or 0 clears the cap.
  set(agentId: string, monthlyUsd: number | null) {
    if (monthlyUsd === null || monthlyUsd <= 0) this.store.database.prepare("DELETE FROM agent_budgets WHERE agent_id = ?").run(agentId);
    else this.store.database.prepare("INSERT INTO agent_budgets (agent_id, monthly_usd) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET monthly_usd = excluded.monthly_usd").run(agentId, monthlyUsd);
  }

  spent(agentId: string, since = startOfMonth()): number {
    const row = this.store.database
      .prepare("SELECT COALESCE(SUM(s.cost_usd), 0) AS usd FROM steps s JOIN runs r ON r.id = s.run_id WHERE s.agent_id = ? AND r.started_at >= ?")
      .get(agentId, since) as { usd: number };
    return row.usd;
  }

  status(agentId: string): BudgetStatus {
    const monthlyUsd = this.limit(agentId);
    const spentUsd = this.spent(agentId);
    return { monthlyUsd, spentUsd, over: monthlyUsd !== null && spentUsd >= monthlyUsd };
  }

  // The message a step fails with, or null when the agent may work.
  refusal(agentId: string, name: string): string | null {
    const s = this.status(agentId);
    return s.over ? `${name} has used its monthly budget ($${s.spentUsd.toFixed(2)} of $${s.monthlyUsd}). The owner can raise it on the Agents page; it resets on the 1st.` : null;
  }
}
