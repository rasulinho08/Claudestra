// Cost analytics (docs/11 §2.5): spend per agent, per model and per day, from the steps/runs projections.
import type { RunStore } from "./store.ts";

export type Analytics = {
  totals: { runs: number; costUsd: number; steps: number };
  today: number;
  month: number;
  byAgent: { agentId: string; steps: number; costUsd: number; avgUsd: number }[];
  byModel: { model: string; steps: number; costUsd: number }[];
  byDay: { day: string; runs: number; costUsd: number }[];
  topSteps: { runId: string; stepId: string; agentId: string; costUsd: number; task: string }[];
};

export function startOfDay(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

export function startOfMonth(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export function analytics(store: RunStore, days = 30): Analytics {
  const db = store.database;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const totals = db.prepare("SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost FROM runs WHERE source = 'claudestra' AND started_at >= ?").get(since) as { runs: number; cost: number };
  const steps = db.prepare("SELECT COUNT(*) AS n FROM steps s JOIN runs r ON r.id = s.run_id WHERE r.started_at >= ?").get(since) as { n: number };
  const byAgent = db
    .prepare(
      `SELECT s.agent_id AS agentId, COUNT(*) AS steps, COALESCE(SUM(s.cost_usd), 0) AS costUsd
       FROM steps s JOIN runs r ON r.id = s.run_id WHERE r.started_at >= ? AND s.agent_id IS NOT NULL
       GROUP BY s.agent_id ORDER BY costUsd DESC`,
    )
    .all(since) as { agentId: string; steps: number; costUsd: number }[];
  const byModel = db
    .prepare(
      `SELECT COALESCE(s.model, 'unknown') AS model, COUNT(*) AS steps, COALESCE(SUM(s.cost_usd), 0) AS costUsd
       FROM steps s JOIN runs r ON r.id = s.run_id WHERE r.started_at >= ? GROUP BY model ORDER BY costUsd DESC`,
    )
    .all(since) as { model: string; steps: number; costUsd: number }[];
  const byDay = db
    .prepare(
      `SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM runs WHERE source = 'claudestra' AND started_at >= ? GROUP BY day ORDER BY day`,
    )
    .all(since) as { day: string; runs: number; costUsd: number }[];
  const topSteps = db
    .prepare(
      `SELECT s.run_id AS runId, s.step_id AS stepId, COALESCE(s.agent_id, '') AS agentId, s.cost_usd AS costUsd, COALESCE(s.task, '') AS task
       FROM steps s JOIN runs r ON r.id = s.run_id WHERE r.started_at >= ? AND s.cost_usd IS NOT NULL ORDER BY s.cost_usd DESC LIMIT 8`,
    )
    .all(since) as Analytics["topSteps"];
  return {
    totals: { runs: totals.runs, costUsd: totals.cost, steps: steps.n },
    today: store.spentSince(startOfDay()),
    month: store.spentSince(startOfMonth()),
    byAgent: byAgent.map((a) => ({ ...a, avgUsd: a.steps ? a.costUsd / a.steps : 0 })),
    byModel,
    byDay,
    topSteps,
  };
}
