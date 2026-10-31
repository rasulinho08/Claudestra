import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { usd } from "../format.ts";
import { go } from "../router.ts";
import { t } from "../i18n.ts";

type Analytics = {
  totals: { runs: number; costUsd: number; steps: number };
  today: number;
  month: number;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  byAgent: { agentId: string; steps: number; costUsd: number; avgUsd: number }[];
  byModel: { model: string; steps: number; costUsd: number }[];
  byDay: { day: string; runs: number; costUsd: number }[];
  topSteps: { runId: string; stepId: string; agentId: string; costUsd: number; task: string }[];
};

function Bars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0.000001);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bar-value nums">
            {usd(r.value) || "$0"}
            {r.sub && <span className="muted small"> {r.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// Cost analytics (docs/11 §2.5): where the money goes, to tune profiles and agents.
export function CostsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Analytics>(`/api/analytics?days=${days}`).then(setData).catch((e) => setError(errorText(e)));
  }, [days]);

  if (error) return <div className="page-scroll"><div className="page-narrow error">{error}</div></div>;
  if (!data) return <div className="page-scroll"><div className="page-narrow muted">Loading…</div></div>;
  const cap = (spent: number, limit: number | null) => (limit === null ? "no cap" : `${Math.round((spent / limit) * 100)}% of $${limit}`);

  return (
    <div className="page-scroll">
      <div className="page-narrow">
        <div className="lib-head">
          <h2>{t("nav.costs")}</h2>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                last {d} days
              </option>
            ))}
          </select>
        </div>
        <div className="kpis">
          <div className="kpi">
            <span className="muted small">Spent ({days}d)</span>
            <strong className="nums">{usd(data.totals.costUsd) || "$0"}</strong>
            <span className="muted small">{data.totals.runs} runs · {data.totals.steps} steps</span>
          </div>
          <div className="kpi">
            <span className="muted small">Today</span>
            <strong className="nums">{usd(data.today) || "$0"}</strong>
            <span className="muted small">{cap(data.today, data.dailyBudgetUsd)}</span>
          </div>
          <div className="kpi">
            <span className="muted small">This month</span>
            <strong className="nums">{usd(data.month) || "$0"}</strong>
            <span className="muted small">{cap(data.month, data.monthlyBudgetUsd)}</span>
          </div>
          <div className="kpi">
            <span className="muted small">Avg per run</span>
            <strong className="nums">{usd(data.totals.runs ? data.totals.costUsd / data.totals.runs : 0) || "$0"}</strong>
          </div>
        </div>
        <h3>By agent</h3>
        <Bars rows={data.byAgent.map((a) => ({ label: a.agentId, value: a.costUsd, sub: `${a.steps} steps · avg ${usd(a.avgUsd)}` }))} />
        <h3>By model</h3>
        <Bars rows={data.byModel.map((m) => ({ label: m.model, value: m.costUsd, sub: `${m.steps} steps` }))} />
        <h3>By day</h3>
        <Bars rows={data.byDay.map((d) => ({ label: d.day.slice(5), value: d.costUsd, sub: `${d.runs} runs` }))} />
        <h3>Most expensive steps</h3>
        <div className="top-steps">
          {data.topSteps.map((s) => (
            <button key={`${s.runId}-${s.stepId}`} className="lib-card" onClick={() => go("runs", { run: s.runId })}>
              <div>
                <span className="nums">{usd(s.costUsd)}</span> <strong>{s.agentId}</strong> <span className="muted small">({s.stepId})</span>
              </div>
              <div className="small muted">{s.task.slice(0, 160)}</div>
            </button>
          ))}
        </div>
        <p className="small muted">
          Tune with <code>DAILY_BUDGET_USD</code>, <code>MONTHLY_BUDGET_USD</code>, the run profiles (eco / balanced / max) and each agent's <code>modelClass</code> and limits.
        </p>
      </div>
    </div>
  );
}
