// Office (docs/17): the team as people on an office floor, plus a command centre: give one task (typed or spoken)
// that runs once or keeps going in the background for days as a mission, and answer what needs you.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HealthResponse, SessionInfo } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";
import { go } from "../router.ts";
import { agentName, t, type Key } from "../i18n.ts";
import { MicButton, appendSpoken } from "../Mic.tsx";
import { AttachButton, AttachedFiles, type Attached } from "../Attach.tsx";
import { OfficeFloor, type FloorWorker } from "../office/OfficeFloor.tsx";
import { eta, type MissionView } from "./MissionsPage.tsx";

type Busy = { runId: string; task: string; status: string; tool: string | null; target: string | null };
type Hq = {
  running: { id: string; prompt: string; origin?: string | null }[];
  approvals: { approvalId: string; runId: string; kind: string; agentId: string | null; prompt: string; tool: string | null; reason: string }[];
  recent: { id: string; status: string }[];
  missions: MissionView[];
  team: { id: string; name: string; persona?: string; color: string; icon: string; description: string; busy: Busy | null; meeting?: boolean; overBudget?: boolean }[];
};

// What the bubble over a working person says.
export function activityLabel(b: Busy): string {
  if (b.status === "waiting_approval") return `⏸ ${t("office.waiting")}`;
  const on = b.target ? `: ${b.target}` : "";
  const tool = b.tool ?? "";
  if (/^(Write|Edit)$/.test(tool)) return `${t("office.writing")}${on}`;
  if (/^(Read|Glob|Grep)$/.test(tool)) return `${t("office.reading")}${on}`;
  if (/^(WebSearch|WebFetch)$/.test(tool)) return `${t("office.searching")}${on}`;
  if (tool === "Bash") return t("office.running");
  if (tool === "Skill") return `${t("office.skill")}${on}`;
  if (tool.startsWith("mcp__")) return `${t("office.app")}: ${tool.split("__")[1] ?? ""}`;
  return t("office.thinking");
}

const DURATIONS = [0, 1, 3, 7, 14] as const;
const INTERVALS = [30, 60, 120, 240, 1440] as const;

export function OfficePage({ health, session }: { health: HealthResponse | null; session?: SessionInfo | null }) {
  const [hq, setHq] = useState<Hq | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [days, setDays] = useState<number>(0);
  const [interval, setIntervalMin] = useState<number>(120);
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; href: string } | null>(null);
  const disabled = health?.canStartRuns === false;

  const load = useCallback(() => {
    api<Hq>("/api/hq")
      .then((h) => {
        setHq(h);
        setError((e) => (e === t("err.server") ? null : e));
      })
      .catch(() => setError(t("err.server")));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 2500);
    return () => window.clearInterval(timer);
  }, [load]);

  const nameOf = (a: Hq["team"][number]) => a.persona || agentName(a.id, a.name);
  const meetingOn = (hq?.team ?? []).some((a) => a.meeting);
  const workers: FloorWorker[] = useMemo(
    () =>
      (hq?.team ?? []).map((a) => ({
        id: a.id,
        name: a.persona || agentName(a.id, a.name),
        color: a.color,
        isBoss: a.id === "ceo",
        status: !a.busy ? "idle" : a.busy.status === "waiting_approval" ? "waiting" : "working",
        tool: a.busy?.tool ?? null,
        meeting: Boolean(a.meeting),
        label: a.busy ? (a.id === "ceo" ? (meetingOn ? t("office.reviewing") : t("office.planning")) : activityLabel(a.busy)) : null,
      })),
    [hq, meetingOn],
  );
  const board: [number, number, number] = useMemo(() => {
    const active = hq?.missions.length ?? 0;
    return [active + (hq?.approvals.length ?? 0), hq?.running.length ?? 0, hq?.recent.filter((r) => r.status === "completed").length ?? 0];
  }, [hq]);

  const [attached, setAttached] = useState<Attached>(null);
  async function send() {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (days > 0) {
        const m = await api<MissionView>("/api/missions", { body: { goal: prompt, days, intervalMinutes: interval, agentId: agentId || null } });
        setNotice({ text: t("office.missionStarted"), href: `#/missions?id=${m.id}` });
      } else {
        const r = await api<{ runId: string }>("/api/runs", { body: { prompt, ...(agentId ? { agentId } : {}), uploadId: attached?.id } });
        setAttached(null);
        setNotice({ text: t("office.taskStarted"), href: `#/runs?run=${r.runId}` });
      }
      setText("");
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(a: Hq["approvals"][number], decision: "approve" | "reject") {
    try {
      await api(`/api/runs/${a.runId}/approvals/${a.approvalId}`, { body: { decision, note: "" } });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  // Clicking a person opens a small card next to them.
  const [picked, setPicked] = useState<{ id: string; x: number; y: number } | null>(null);
  function pick(id: string | null, at: { x: number; y: number }) {
    setPicked(id ? { id, x: Math.min(at.x, window.innerWidth - 290), y: Math.min(at.y + 12, window.innerHeight - 220) } : null);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicked(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pickedAgent = picked ? hq?.team.find((x) => x.id === picked.id) : undefined;
  const mainRef = useRef<HTMLElement | null>(null);
  const toggleFull = () => (document.fullscreenElement ? void document.exitFullscreen() : void mainRef.current?.requestFullscreen?.().catch(() => {}));

  const working = workers.filter((w) => w.status !== "idle").length;
  const isOwner = (session?.user?.role ?? "owner") === "owner";

  return (
    <div className="office-page">
      <section className="office-main" ref={mainRef}>
        <header className="office-head">
          <div>
            <h1>{t("office.title")}</h1>
            <p className="muted small">{working === 0 ? t("office.quiet") : t("office.busy", { n: working })}</p>
          </div>
          <div className="office-legend small muted" aria-hidden="true">
            <span>📚 {t("office.legendRead")}</span>
            <span>🌐 {t("office.legendWeb")}</span>
            <span>🖥 {t("office.legendRun")}</span>
            <span>⏸ {t("office.legendWait")}</span>
          </div>
        </header>
        <div className="office-stage">
          <OfficeFloor workers={workers} board={board} onPick={pick} selected={picked?.id ?? null} ariaLabel={t("office.aria", { n: workers.length, busy: working })} />
          <button className="office-full ghost" onClick={toggleFull} title={t("office.fullscreen")} aria-label={t("office.fullscreen")}>
            ⛶
          </button>
        </div>
        {picked && pickedAgent && (
          <div className="office-pop" style={{ left: picked.x, top: picked.y, "--agent": pickedAgent.color } as React.CSSProperties} role="dialog" aria-label={nameOf(pickedAgent)}>
            <button className="linkish office-pop-close" onClick={() => setPicked(null)} aria-label={t("office.close")}>
              ✕
            </button>
            <strong>{nameOf(pickedAgent)}</strong>
            <div className="small muted">{pickedAgent.persona ? agentName(pickedAgent.id, pickedAgent.name) : pickedAgent.description.slice(0, 90)}</div>
            <div className="small office-pop-status">
              <span className={`chip ${pickedAgent.busy ? (pickedAgent.busy.status === "waiting_approval" ? "chip-warn" : "chip-ok") : ""}`}>
                {pickedAgent.busy ? (pickedAgent.busy.status === "waiting_approval" ? t("office.stateWaiting") : t("office.stateWorking")) : t("office.stateIdle")}
              </span>{" "}
              {pickedAgent.busy ? (pickedAgent.id === "ceo" ? t("office.planning") : activityLabel(pickedAgent.busy)) : ""}
            </div>
            {pickedAgent.busy?.task && <div className="small office-pop-task">{pickedAgent.busy.task.slice(0, 160)}</div>}
            <div className="row-gap">
              {pickedAgent.busy && (
                <a className="ghost" href={`#/runs?run=${pickedAgent.busy.runId}`}>
                  👁 {t("missions.watch")}
                </a>
              )}
              <a className="ghost" href={pickedAgent.id === "ceo" ? "#/chat" : `#/chat?agent=${pickedAgent.id}`}>
                💬 {t("nav.chat")}
              </a>
              <a className="ghost" href="#/agents">
                🎓 {t("office.profile")}
              </a>
            </div>
          </div>
        )}
        <div className="office-cards" role="list">
          {(hq?.team ?? []).map((a) => (
            <button key={a.id} role="listitem" className={`office-card ${a.busy ? "busy" : ""}`} style={{ "--agent": a.color } as React.CSSProperties} onClick={(e) => pick(a.id, { x: e.clientX, y: e.clientY })} title={a.busy?.task || a.description}>
              <span className="office-card-name">{nameOf(a)}</span>
              <span className={`chip ${a.busy ? (a.busy.status === "waiting_approval" ? "chip-warn" : "chip-ok") : ""}`}>
                {a.busy ? (a.busy.status === "waiting_approval" ? t("office.stateWaiting") : t("office.stateWorking")) : a.overBudget ? t("agents.budgetOver") : a.meeting ? t("office.stateMeeting") : t("office.stateIdle")}
              </span>
              <span className="small muted office-card-line">{a.busy ? (a.id === "ceo" ? t("office.planning") : activityLabel(a.busy)) : a.persona ? agentName(a.id, a.name) : ""}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="office-side">
        <h2>{t("office.command")}</h2>
        <p className="small muted">{t("office.commandHelp")}</p>
        <div className="office-compose">
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
            }}
            placeholder={disabled ? t("composer.disabled") : t("office.placeholder")}
            disabled={disabled}
            aria-label={t("office.command")}
          />
          <div className="office-options">
            <label className="field-inline">
              <span className="small muted">{t("office.howLong")}</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? t("office.once") : t("office.days", { n: d })}
                  </option>
                ))}
              </select>
            </label>
            {days > 0 && (
              <label className="field-inline">
                <span className="small muted">{t("office.every")}</span>
                <select value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
                  {INTERVALS.map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? t("office.minutes", { n: m }) : m === 1440 ? t("office.daily") : t("office.hours", { n: m / 60 })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field-inline">
              <span className="small muted">{t("office.who")}</span>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">{t("office.wholeTeam")}</option>
                {(hq?.team ?? [])
                  .filter((a) => a.id !== "ceo")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {nameOf(a)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="office-send">
            {days === 0 && <AttachButton value={attached} onChange={setAttached} disabled={disabled} />}
            <MicButton onText={(spoken) => setText((cur) => appendSpoken(cur, spoken))} disabled={disabled} />
            <button className="hq-new" onClick={() => void send()} disabled={!text.trim() || busy || disabled}>
              {days > 0 ? `▶ ${t("office.startMission")}` : `▶ ${t("office.start")}`}
            </button>
          </div>
          {days === 0 && <AttachedFiles value={attached} onClear={() => setAttached(null)} />}
          {days > 0 && <p className="small muted">{t("office.missionHint", { days, n: Math.max(1, Math.round((days * 1440) / interval)) })}</p>}
          {notice && (
            <p className="small">
              ✓ {notice.text} <a href={notice.href}>{t("office.open")} →</a>
            </p>
          )}
          {error && <div className="error small">{error}</div>}
        </div>

        {(hq?.approvals.length ?? 0) > 0 && (
          <section className="office-block attention">
            <h3>⏸ {t("hq.approvals")}</h3>
            {hq!.approvals.map((a) => {
              const who = hq!.team.find((x) => x.id === a.agentId);
              return (
                <div key={a.approvalId} className="office-approval">
                  <div className="small">
                    <strong style={{ color: who?.color }}>{who ? nameOf(who) : ""}</strong> {a.kind === "plan" ? t("hq.planWaiting") : `${t("approval.wants")} ${a.tool ?? ""}`}
                  </div>
                  <div className="approval-actions">
                    {a.kind === "plan" || !isOwner ? (
                      <button className="ghost" onClick={() => go("runs", { run: a.runId })}>
                        {t("office.open")}
                      </button>
                    ) : (
                      <>
                        <button className="btn-ok" onClick={() => void decide(a, "approve")}>
                          {t("approval.approve")}
                        </button>
                        <button className="btn-bad" onClick={() => void decide(a, "reject")}>
                          {t("approval.reject")}
                        </button>
                        <button className="ghost" onClick={() => go("runs", { run: a.runId })}>
                          {t("office.open")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        <section className="office-block">
          <h3>🚀 {t("nav.missions")}</h3>
          {(hq?.missions.length ?? 0) === 0 ? (
            <p className="small muted">{t("office.noMissions")}</p>
          ) : (
            hq!.missions.map((m) => (
              <a key={m.id} className="office-mission" href={`#/missions?id=${m.id}`}>
                <span className="office-mission-title">{m.title}</span>
                <span className={`chip ${m.currentRunId ? "chip-ok" : m.status === "paused" ? "chip-warn" : ""}`}>{m.currentRunId ? t("missions.workingNow") : t(`missions.status.${m.status}` as Key)}</span>
                <span className="small muted">
                  {t("missions.sessions", { n: m.ticks })}
                  {m.status === "active" && !m.currentRunId && m.nextTickAt ? ` · ${t("missions.next")} ${eta(m.nextTickAt)}` : ""}
                </span>
              </a>
            ))
          )}
          <a className="small" href="#/missions">
            {t("office.allMissions")} →
          </a>
        </section>

        {(hq?.running.length ?? 0) > 0 && (
          <section className="office-block">
            <h3>⚙ {t("hq.workingNow")}</h3>
            {hq!.running.slice(0, 5).map((r) => (
              <a key={r.id} className="hq-row" href={`#/runs?run=${r.id}`}>
                <span className="dot dot-running" />
                <span className="hq-row-main">{r.prompt}</span>
              </a>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}
