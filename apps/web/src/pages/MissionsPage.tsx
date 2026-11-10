// Missions (docs/17): long-running background work. One goal, and the team keeps working on it in sessions spread
// over days. The board and the journal are the mission's own files, written by the agents.
import { useCallback, useEffect, useState } from "react";
import type { HealthResponse, SessionInfo } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";
import { usd } from "../format.ts";
import { go } from "../router.ts";
import { agentName, t, type Key } from "../i18n.ts";
import { Markdown } from "../Markdown.tsx";
import { MicButton, appendSpoken } from "../Mic.tsx";
import { boardSize, parseBoard, type Column } from "../missionBoard.ts";

export type MissionView = {
  id: string; title: string; goal: string; agentId: string | null; status: "active" | "paused" | "done" | "stopped" | "failed";
  intervalMinutes: number; endsAt: string; budgetUsd: number | null; approvalMode: string; ticks: number; spentUsd: number;
  currentRunId: string | null; lastRunId: string | null; nextTickAt: string | null; lastError: string | null; note: string;
  createdBy: string | null; createdAt: string; waitingApproval: number;
};
type Detail = MissionView & { runs: { runId: string; tick: number; startedAt: string; status: string; costUsd: number | null }[]; board: string; journal: string; filesRunId: string | null };
type Agent = { id: string; name: string; persona?: string };

export const ago = (iso: string | null) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return t("time.justNow");
  if (s < 3600) return t("time.minutes", { n: Math.round(s / 60) });
  if (s < 86400) return t("time.hours", { n: Math.round(s / 3600) });
  return t("time.days", { n: Math.round(s / 86400) });
};
// "in 12 min", "in 3 h", "in 2 days"
export const eta = (iso: string) => {
  const s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000);
  if (s < 60) return t("missions.soon");
  if (s < 3600) return t("missions.inMinutes", { n: Math.round(s / 60) });
  if (s < 86400 * 2) return t("missions.inHours", { n: Math.round(s / 3600) });
  return t("missions.inDays", { n: Math.round(s / 86400) });
};
const pad = (n: number) => String(n).padStart(2, "0");
// Own format: some browsers have no Azerbaijani month names ("M11 17").
const day = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const chipClass = (m: MissionView) => (m.currentRunId || m.status === "done" ? "chip-ok" : m.status === "paused" || m.status === "failed" ? "chip-warn" : "");

export function MissionsPage({ health, session, initial }: { health: HealthResponse | null; session?: SessionInfo | null; initial: string | null }) {
  const [list, setList] = useState<MissionView[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState<string | null>(initial);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"board" | "journal" | "sessions">("board");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const isOwner = (session?.user?.role ?? "owner") === "owner";

  const load = useCallback(() => {
    api<MissionView[]>("/api/missions").then(setList).catch((e) => setError(errorText(e)));
    if (open) api<Detail>(`/api/missions/${open}`).then(setDetail).catch(() => setDetail(null));
  }, [open]);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    api<Agent[]>("/api/agents").then(setAgents).catch(() => {});
  }, []);
  useEffect(() => setDetail(null), [open]);

  const who = (id: string | null) => {
    const a = agents.find((x) => x.id === id);
    return id ? (a ? a.persona || agentName(a.id, a.name) : id) : t("office.wholeTeam");
  };

  async function act(action: "pause" | "resume" | "stop" | "now") {
    if (!detail) return;
    if (action === "stop" && !window.confirm(t("missions.confirmStop"))) return;
    try {
      await api(`/api/missions/${detail.id}/${action}`, { body: {} });
      setError(null);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function remove() {
    if (!detail || !window.confirm(t("missions.confirmDelete"))) return;
    await api(`/api/missions/${detail.id}`, { method: "DELETE" }).catch((e) => setError(errorText(e)));
    setOpen(null);
    load();
  }

  const progress = detail ? Math.min(1, Math.max(0, (Date.now() - Date.parse(detail.createdAt)) / Math.max(1, Date.parse(detail.endsAt) - Date.parse(detail.createdAt)))) : 0;

  return (
    <div className="lib-page missions-page">
      <div className="lib-list">
        <div className="lib-head">
          <h2>{t("nav.missions")}</h2>
          <button onClick={() => (setCreating(true), setOpen(null))}>+ {t("missions.new")}</button>
        </div>
        <p className="small muted">{t("missions.intro")}</p>
        {list.length === 0 && <p className="muted small">{t("office.noMissions")}</p>}
        {list.map((m) => (
          <button key={m.id} className={`lib-card ${open === m.id ? "active" : ""}`} onClick={() => (setCreating(false), setOpen(m.id))}>
            <div className="mission-row">
              <strong>{m.title}</strong>
              <span className={`chip ${chipClass(m)}`}>{m.currentRunId ? t("missions.workingNow") : t(`missions.status.${m.status}` as Key)}</span>
            </div>
            <div className="small muted">
              {who(m.agentId)} · {t("missions.sessions", { n: m.ticks })}
              {m.waitingApproval > 0 ? ` · ⏸ ${t("missions.needsYou")}` : m.status === "active" && !m.currentRunId && m.nextTickAt ? ` · ${t("missions.next")} ${eta(m.nextTickAt)}` : ""}
            </div>
          </button>
        ))}
      </div>

      <div className="lib-editor">
        {error && <div className="error small">{error}</div>}
        {creating || (!open && list.length === 0) ? (
          <NewMission
            agents={agents}
            isOwner={isOwner}
            disabled={health?.canStartRuns === false}
            onCreated={(m) => {
              setCreating(false);
              setOpen(m.id);
              go("missions", { id: m.id });
            }}
          />
        ) : !open ? (
          <p className="muted">{t("missions.pick")}</p>
        ) : !detail ? (
          <p className="muted">{t("files.loading")}</p>
        ) : (
          <div className="mission-detail">
            <div className="mission-head">
              <div>
                <h3>{detail.title}</h3>
                <div className="small muted">
                  {who(detail.agentId)} · {t("missions.everyX", { x: detail.intervalMinutes < 60 ? t("office.minutes", { n: detail.intervalMinutes }) : detail.intervalMinutes === 1440 ? t("office.daily") : t("office.hours", { n: detail.intervalMinutes / 60 }) })} · {t("missions.until", { date: day(detail.endsAt) })}
                </div>
              </div>
              <span className={`chip ${chipClass(detail)}`}>{detail.currentRunId ? t("missions.workingNow") : t(`missions.status.${detail.status}` as Key)}</span>
            </div>

            <div className="mission-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={t("missions.timeUsed")}>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mission-stats">
              <div>
                <div className="hq-big nums">{detail.ticks}</div>
                <div className="small muted">{t("missions.sessionsLabel")}</div>
              </div>
              <div>
                <div className="hq-big nums">{usd(detail.spentUsd) || "$0"}</div>
                <div className="small muted">{detail.budgetUsd !== null ? t("missions.ofBudget", { n: detail.budgetUsd }) : t("missions.spent")}</div>
              </div>
              <div>
                <div className="hq-big">{detail.currentRunId ? "▶" : detail.status === "active" && detail.nextTickAt ? eta(detail.nextTickAt) : "–"}</div>
                <div className="small muted">{detail.currentRunId ? t("missions.workingNow") : t("missions.nextSession")}</div>
              </div>
            </div>

            {detail.waitingApproval > 0 && detail.currentRunId && (
              <div className="banner">
                ⏸ {t("missions.waitingApproval")} <a href={`#/runs?run=${detail.currentRunId}`}>{t("office.open")} →</a>
              </div>
            )}
            {detail.lastError && <div className="error small">{detail.lastError}</div>}

            <div className="row-gap mission-actions">
              {detail.currentRunId && (
                <a className="ghost" href={`#/runs?run=${detail.currentRunId}`}>
                  👁 {t("missions.watch")}
                </a>
              )}
              {detail.status === "active" && !detail.currentRunId && (
                <button className="ghost" onClick={() => void act("now")}>
                  ⏩ {t("missions.runNow")}
                </button>
              )}
              {detail.status === "active" ? (
                <button className="ghost" onClick={() => void act("pause")}>
                  ⏸ {t("missions.pause")}
                </button>
              ) : (
                Date.parse(detail.endsAt) > Date.now() && (
                  <button className="ghost" onClick={() => void act("resume")}>
                    ▶ {t("missions.resume")}
                  </button>
                )
              )}
              {(detail.status === "active" || detail.status === "paused") && (
                <button className="ghost" onClick={() => void act("stop")}>
                  ■ {t("missions.stop")}
                </button>
              )}
              <button className="ghost" onClick={() => void remove()}>
                {t("skills.delete")}
              </button>
            </div>

            <details className="card">
              <summary className="small">{t("missions.goal")}</summary>
              <p className="mission-goal">{detail.goal}</p>
            </details>
            <NoteBox key={detail.id} mission={detail} onSaved={load} />

            <div className="tabs">
              {(["board", "journal", "sessions"] as const).map((k) => (
                <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                  {t(`missions.tab.${k}` as Key)}
                </button>
              ))}
            </div>
            {tab === "sessions" ? (
              detail.runs.length === 0 ? (
                <p className="muted small">{t("missions.noSessions")}</p>
              ) : (
                detail.runs.map((r) => (
                  <a key={r.runId} className="hq-row" href={`#/runs?run=${r.runId}`}>
                    <span className={`dot dot-${r.status}`} />
                    <span className="hq-row-main">
                      {t("missions.session")} {r.tick}
                    </span>
                    <span className="small muted nums">
                      {t(`status.${r.status}` as Key)} · {ago(r.startedAt)}
                      {r.costUsd ? ` · ${usd(r.costUsd)}` : ""}
                    </span>
                  </a>
                ))
              )
            ) : tab === "board" && detail.board ? (
              <BoardView markdown={detail.board} />
            ) : tab === "journal" && detail.journal ? (
              <Markdown text={detail.journal} className="mission-doc" />
            ) : (
              <p className="muted small">{t("missions.noFile")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const COLUMNS: { key: Column; color: string }[] = [
  { key: "blocked", color: "var(--accent)" },
  { key: "todo", color: "#94a3b8" },
  { key: "doing", color: "var(--info)" },
  { key: "done", color: "var(--ok)" },
];

// The board file as kanban columns; the raw text stays one click away (the agents may write more than lists).
function BoardView({ markdown }: { markdown: string }) {
  const [asText, setAsText] = useState(false);
  const board = parseBoard(markdown);
  const all = boardSize(board);
  if (all === 0 || asText) {
    return (
      <>
        {all > 0 && (
          <div className="kanban-tools">
            <span />
            <button className="linkish small" onClick={() => setAsText(false)}>
              {t("missions.asBoard")}
            </button>
          </div>
        )}
        <Markdown text={markdown} className="mission-doc" />
      </>
    );
  }
  return (
    <>
      <div className="kanban-tools">
        <span className="small muted">{t("missions.progress", { done: board.done.length, all })}</span>
        <button className="linkish small" onClick={() => setAsText(true)}>
          {t("missions.asText")}
        </button>
      </div>
      <div className="mission-progress" role="progressbar" aria-valuemin={0} aria-valuemax={all} aria-valuenow={board.done.length} aria-label={t("missions.progress", { done: board.done.length, all })}>
        <span style={{ width: `${(board.done.length / all) * 100}%`, background: "var(--ok)" }} />
      </div>
      <div className="kanban">
        {COLUMNS.filter((c) => c.key !== "blocked" || board.blocked.length > 0).map((c) => (
          <section key={c.key} className={`kanban-col ${c.key}`} style={{ "--col": c.color } as React.CSSProperties}>
            <h4>
              <span>{t(`missions.col.${c.key}` as Key)}</span>
              <span>{board[c.key].length}</span>
            </h4>
            {board[c.key].map((item, i) => (
              <div key={i} className="kanban-card">
                {item}
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function NoteBox({ mission, onSaved }: { mission: MissionView; onSaved: () => void }) {
  const [note, setNote] = useState(mission.note);
  const [saved, setSaved] = useState(false);
  async function save() {
    await api(`/api/missions/${mission.id}/note`, { body: { note } }).catch(() => {});
    setSaved(true);
    onSaved();
  }
  return (
    <label className="field">
      <span className="small muted">{t("missions.note")}</span>
      <div className="mission-note">
        <textarea rows={2} maxLength={4000} value={note} onChange={(e) => (setNote(e.target.value), setSaved(false))} placeholder={t("missions.notePlaceholder")} />
        <MicButton onText={(spoken) => (setNote((cur) => appendSpoken(cur, spoken)), setSaved(false))} />
        <button className="ghost" onClick={() => void save()} disabled={saved || note === mission.note}>
          {saved ? "✓" : t("skills.save")}
        </button>
      </div>
    </label>
  );
}

function NewMission({ agents, isOwner, disabled, onCreated }: { agents: Agent[]; isOwner: boolean; disabled: boolean; onCreated: (m: MissionView) => void }) {
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState(7);
  const [interval, setIntervalMin] = useState(120);
  const [agentId, setAgentId] = useState("");
  const [mode, setMode] = useState<"manual" | "smart" | "auto">("smart");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const b = Number(budget.replace(",", "."));
      onCreated(await api<MissionView>("/api/missions", { body: { goal, days, intervalMinutes: interval, agentId: agentId || null, approvalMode: mode, budgetUsd: budget.trim() && b > 0 ? b : null } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mission-new">
      <h3>{t("missions.newTitle")}</h3>
      <p className="small muted">{t("missions.newHelp")}</p>
      <label className="field">
        <span className="small muted">{t("missions.goal")}</span>
        <div className="mission-note">
          <textarea rows={6} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("missions.goalPlaceholder")} disabled={disabled} />
          <MicButton onText={(spoken) => setGoal((cur) => appendSpoken(cur, spoken))} disabled={disabled} />
        </div>
      </label>
      <div className="office-options">
        <label className="field-inline">
          <span className="small muted">{t("office.howLong")}</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {t("office.days", { n: d })}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="small muted">{t("office.every")}</span>
          <select value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
            {[30, 60, 120, 240, 720, 1440].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? t("office.minutes", { n: m }) : m === 1440 ? t("office.daily") : t("office.hours", { n: m / 60 })}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="small muted">{t("office.who")}</span>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">{t("office.wholeTeam")}</option>
            {agents
              .filter((a) => a.id !== "ceo")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.persona || agentName(a.id, a.name)}
                </option>
              ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="small muted">{t("composer.mode")}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            {(isOwner ? (["manual", "smart", "auto"] as const) : (["manual", "smart"] as const)).map((m) => (
              <option key={m} value={m}>
                {t(`mode.${m}` as Key)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="small muted">{t("missions.budget")}</span>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="$" style={{ width: 90 }} />
        </label>
      </div>
      <p className="small muted">{t("office.missionHint", { days, n: Math.max(1, Math.round((days * 1440) / interval)) })}</p>
      {error && <div className="error small">{error}</div>}
      <div className="row-gap">
        <button className="hq-new" onClick={() => void create()} disabled={goal.trim().length < 3 || busy || disabled}>
          ▶ {t("office.startMission")}
        </button>
      </div>
    </div>
  );
}
