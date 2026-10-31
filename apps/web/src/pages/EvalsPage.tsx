import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { go } from "../router.ts";
import { usd } from "../format.ts";
import { t } from "../i18n.ts";

type Suite = { file: string; name: string; description: string; profile: string; cases: { id: string; prompt: string }[]; error?: string };
type CaseResult = { caseId: string; runId: string | null; passed: boolean; costUsd: number | null; checks: { check: string; passed: boolean; detail: string }[] };
type EvalRun = { id: string; suite: string; status: "running" | "done"; startedAt: string; passed: number; total: number; costUsd: number; results: CaseResult[] };

// Agent evals: suites in evals/*.json; run them after changing prompts, models or profiles and compare.
export function EvalsPage() {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [history, setHistory] = useState<EvalRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ suites: Suite[]; history: EvalRun[] }>("/api/evals")
      .then((d) => {
        setSuites(d.suites);
        setHistory(d.history);
      })
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function run(file: string) {
    setError(null);
    try {
      await api(`/api/evals/${file}/run`, { body: {} });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="page-scroll">
      <div className="page-narrow">
        <h2>{t("nav.evals")}</h2>
        <p className="muted small">
          A suite is a list of prompts with checks (route, answer contains, file exists, max cost, agents used…) in <code>evals/*.json</code>. Cases run one at a time as normal runs
          (default profile eco, auto-approve), so they cost money: the smoke suite is a few cents.
        </p>
        {error && <div className="error small">{error}</div>}
        <div className="app-grid">
          {suites.map((s) => (
            <div key={s.file} className="app-card">
              <div className="lib-head">
                <strong>{s.name}</strong>
                <button className="btn-primary" disabled={Boolean(s.error) || history.some((h) => h.suite === s.file && h.status === "running")} onClick={() => run(s.file)}>
                  ▶ Run
                </button>
              </div>
              <div className="small muted">{s.error ?? s.description}</div>
              <div className="small">
                {s.cases.length} cases · {s.profile}
              </div>
            </div>
          ))}
        </div>
        <h3>Results</h3>
        {history.length === 0 && <p className="muted small">No eval runs yet.</p>}
        {history.map((h) => (
          <details key={h.id} className="card" open={h === history[0]}>
            <summary>
              <strong>{h.suite}</strong> · {new Date(h.startedAt).toLocaleString()} ·{" "}
              <span className={h.passed === h.total ? "ok-text" : "bad-text"}>
                {h.passed}/{h.total} passed
              </span>{" "}
              · {usd(h.costUsd) || "$0"} {h.status === "running" && <span className="chip">running {h.results.length}/{h.total}</span>}
            </summary>
            {h.results.map((r) => (
              <div key={r.caseId} className="eval-case">
                <div>
                  {r.passed ? "✅" : "❌"} <strong>{r.caseId}</strong> <span className="muted small">{usd(r.costUsd)}</span>{" "}
                  {r.runId && (
                    <button className="linkish small" onClick={() => go("runs", { run: r.runId! })}>
                      open run →
                    </button>
                  )}
                </div>
                <div className="tags">
                  {r.checks.map((c, i) => (
                    <span key={i} className={`tag ${c.passed ? "tag-ok" : "tag-bad"}`} title={c.detail}>
                      {c.check}: {c.detail}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </details>
        ))}
      </div>
    </div>
  );
}
