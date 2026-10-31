// Company HQ (upgrade V4): the home screen. What needs your OK, who is working on what, recent work, what is coming,
// spend and projects, on one page. Refreshes every few seconds (the same data the Runs page polls).
import { useCallback, useEffect, useState } from "react";
import type { RunSummary } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";
import { usd } from "../format.ts";
import { go } from "../router.ts";
import { agentName, lang, t, type Key } from "../i18n.ts";
import { iconFor } from "../icons.ts";
import { shortPath } from "../Timeline.tsx";

type Hq = {
  authMode: string;
  running: (RunSummary & { active: { stepId: string; agentId: string | null; status: string }[] })[];
  approvals: { approvalId: string; runId: string; stepId: string | null; kind: string; agentId: string | null; prompt: string; tool: string | null; input: unknown; reason: string; createdAt: string }[];
  recent: RunSummary[];
  upcoming: { id: string; name: string; workflow: string; nextRunAt: string }[];
  spend: { today: number; month: number; dailyCap: number | null; monthlyCap: number | null };
  projects: { id: string; name: string; runs: number; lastRunAt: string | null; folder: string | null }[];
  team: { id: string; name: string; color: string; icon: string; description: string; modelClass: string; skills: number; busy: { runId: string; task: string } | null }[];
};

// Own wording: some browsers ship only minimal Azerbaijani data for Intl.RelativeTimeFormat ("-9 s").
const ago = (iso: string | null) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return t("time.justNow");
  if (s < 3600) return t("time.minutes", { n: Math.round(s / 60) });
  if (s < 86400) return t("time.hours", { n: Math.round(s / 3600) });
  return t("time.days", { n: Math.round(s / 86400) });
};
const when = (iso: string) => new Date(iso).toLocaleString(lang() === "az" ? "az-AZ" : undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function what(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.command === "string") return i.command;
  if (typeof i.file_path === "string") return shortPath(i.file_path);
  if (typeof i.url === "string") return i.url;
  return input ? JSON.stringify(input).slice(0, 120) : "";
}

export function HqPage() {
  const [hq, setHq] = useState<Hq | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Hq>("/api/hq")
      .then((h) => {
        setHq(h);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function decide(a: Hq["approvals"][number], decision: "approve" | "reject") {
    setBusy(a.approvalId);
    try {
      const note = decision === "reject" ? (window.prompt(t("approval.rejectNote")) ?? "") : "";
      await api(`/api/runs/${a.runId}/approvals/${a.approvalId}`, { body: { decision, note } });
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (!hq) return <div className="hq-page">{error ? <div className="error">{error}</div> : <p className="muted">{t("files.loading")}</p>}</div>;
  const nameOf = (id: string | null) => {
    const a = hq.team.find((x) => x.id === id);
    return a ? agentName(a.id, a.name) : (id ?? "");
  };
  const colorOf = (id: string | null) => hq.team.find((x) => x.id === id)?.color ?? "var(--muted)";
  const working = hq.team.filter((a) => a.busy).length;

  return (
    <div className="hq-page">
      <header className="hq-hero">
        <div>
          <h1>{t("hq.title")}</h1>
          <p className="muted">
            {hq.running.length === 0 ? t("hq.allQuiet") : t("hq.busyLine", { runs: hq.running.length, agents: working })}
            {hq.approvals.length > 0 && <strong className="hq-alert"> · {t("hq.needsYou", { n: hq.approvals.length })}</strong>}
          </p>
        </div>
        <button className="hq-new" onClick={() => go("runs")}>
          + {t("hq.newTask")}
        </button>
      </header>
      {error && <div className="error small">{error}</div>}

      <div className="hq-grid">
        <section className={`hq-card hq-approvals ${hq.approvals.length ? "attention" : ""}`}>
          <h3>⏸ {t("hq.approvals")}</h3>
          {hq.approvals.length === 0 ? (
            <p className="muted small">{t("hq.noApprovals")}</p>
          ) : (
            hq.approvals.map((a) => (
              <div key={a.approvalId} className="hq-approval">
                <div>
                  <strong style={{ color: colorOf(a.agentId) }}>{nameOf(a.agentId)}</strong>{" "}
                  {a.kind === "plan" ? (
                    <span>{t("hq.planWaiting")}</span>
                  ) : (
                    <span>
                      {t("approval.wants")} <strong>{a.tool}</strong> <code>{what(a.input)}</code>
                    </span>
                  )}
                </div>
                <div className="small muted">
                  <a href={`#/runs?run=${a.runId}`}>{a.prompt.slice(0, 80)}</a> · {a.reason}
                </div>
                <div className="approval-actions">
                  {a.kind === "plan" ? (
                    <button className="ghost" onClick={() => go("runs", { run: a.runId })}>
                      {t("hq.openPlan")}
                    </button>
                  ) : (
                    <>
                      <button className="btn-ok" disabled={busy === a.approvalId} onClick={() => decide(a, "approve")}>
                        {t("approval.approve")}
                      </button>
                      <button className="btn-bad" disabled={busy === a.approvalId} onClick={() => decide(a, "reject")}>
                        {t("approval.reject")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </section>

        <section className="hq-card">
          <h3>⚙ {t("hq.workingNow")}</h3>
          {hq.running.length === 0 ? (
            <p className="muted small">{t("hq.nothingRunning")}</p>
          ) : (
            hq.running.map((r) => (
              <a key={r.id} className="hq-row" href={`#/runs?run=${r.id}`}>
                <span className="dot dot-running" />
                <span className="hq-row-main">{r.prompt}</span>
                <span className="hq-chips">
                  {r.active.map((s) => (
                    <span key={s.stepId} className="chip" style={{ borderColor: colorOf(s.agentId), color: colorOf(s.agentId) }}>
                      {nameOf(s.agentId)}
                    </span>
                  ))}
                </span>
              </a>
            ))
          )}
        </section>

        <section className="hq-card hq-team">
          <h3>👥 {t("roster.title")}</h3>
          <div className="hq-team-grid">
            {hq.team
              .filter((a) => a.id !== "ceo")
              .map((a) => (
                <div key={a.id} className={`hq-agent ${a.busy ? "busy" : ""}`} style={{ "--agent": a.color } as React.CSSProperties} title={a.busy ? a.busy.task : a.description}>
                  <span className="hq-agent-icon">{iconFor(a.icon)}</span>
                  <span className="hq-agent-name">{agentName(a.id, a.name)}</span>
                  <span className="small muted">{a.busy ? t("hq.busy") : t("hq.free")}</span>
                </div>
              ))}
          </div>
          <a className="small" href="#/agents">
            {t("hq.manageTeam")} →
          </a>
        </section>

        <section className="hq-card">
          <h3>🕘 {t("hq.recent")}</h3>
          {hq.recent.length === 0 ? (
            <p className="muted small">{t("runs.none")}</p>
          ) : (
            hq.recent.map((r) => (
              <a key={r.id} className="hq-row" href={`#/runs?run=${r.id}`}>
                <span className={`dot dot-${r.status}`} />
                <span className="hq-row-main">{r.prompt}</span>
                <span className="small muted nums">
                  {t(`status.${r.status}` as Key)} · {ago(r.startedAt)}
                  {r.costUsd ? ` · ${usd(r.costUsd)}` : ""}
                </span>
              </a>
            ))
          )}
        </section>

        <section className="hq-card">
          <h3>📁 {t("nav.projects")}</h3>
          {hq.projects.length === 0 ? (
            <p className="muted small">{t("hq.noProjects")}</p>
          ) : (
            hq.projects.map((p) => (
              <a key={p.id} className="hq-row" href={`#/projects?id=${p.id}`}>
                <span className="hq-row-main">{p.name}</span>
                <span className="small muted">
                  {t("projects.runs", { n: p.runs })}
                  {p.lastRunAt ? ` · ${ago(p.lastRunAt)}` : ""}
                </span>
              </a>
            ))
          )}
          <a className="small" href="#/projects">
            {t("hq.allProjects")} →
          </a>
        </section>

        <section className="hq-card">
          <h3>📅 {t("hq.upcoming")}</h3>
          {hq.upcoming.length === 0 ? (
            <p className="muted small">{t("hq.noUpcoming")}</p>
          ) : (
            hq.upcoming.map((u) => (
              <div key={u.id} className="hq-row">
                <span className="hq-row-main">{u.name}</span>
                <span className="small muted">{when(u.nextRunAt)}</span>
              </div>
            ))
          )}
          <a className="small" href="#/workflows">
            {t("nav.workflows")} →
          </a>
        </section>

        <section className="hq-card">
          <h3>💰 {t("nav.costs")}</h3>
          <div className="hq-spend">
            <div>
              <div className="hq-big nums">{usd(hq.spend.today) || "$0"}</div>
              <div className="small muted">
                {t("hq.today")}
                {hq.spend.dailyCap !== null ? ` / $${hq.spend.dailyCap}` : ""}
              </div>
            </div>
            <div>
              <div className="hq-big nums">{usd(hq.spend.month) || "$0"}</div>
              <div className="small muted">
                {t("hq.month")}
                {hq.spend.monthlyCap !== null ? ` / $${hq.spend.monthlyCap}` : ""}
              </div>
            </div>
          </div>
          <a className="small" href="#/costs">
            {t("hq.details")} →
          </a>
        </section>
      </div>
    </div>
  );
}
