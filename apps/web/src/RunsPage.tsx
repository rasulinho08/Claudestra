import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ApprovalMode, ClaudestraEvent, HealthResponse, Profile, RunSummary } from "@claudestra/protocol";
import { useRunEvents } from "./useRunEvents.ts";
import { activeStep, emptyRun, reduceRun, totalUsage, type RunView } from "./run-state.ts";
import { Canvas } from "./Canvas.tsx";
import { Inspector, type Selection } from "./Inspector.tsx";
import { ApprovalButtons, shortPath } from "./Timeline.tsx";
import { Stage } from "./stage/Stage.tsx";
import { seconds, tokens, usd } from "./format.ts";
import { api, errorText } from "./api.ts";
import { agentFor } from "./graph.ts";

const VIEW_KEY = "claudestra.view";
const OPTS_KEY = "claudestra.runOptions";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private window): preferences just are not remembered.
  }
}

export function RunsPage({ health, initialRun }: { health: HealthResponse | null; initialRun: string | null }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(initialRun);
  const [selection, setSelection] = useState<Selection>(null);
  const [follow, setFollow] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState<"graph" | "stage">(() => load(VIEW_KEY, { view: "graph" as "graph" | "stage" }).view);
  const [opts, setOpts] = useState<{ profile: Profile | ""; approvalMode: ApprovalMode | "" }>(() => load(OPTS_KEY, { profile: "", approvalMode: "" }));
  const [cursor, setCursor] = useState<number | null>(null);
  const live = useRunEvents(runId);

  const profile = opts.profile || health?.defaultProfile || "balanced";
  const approvalMode = opts.approvalMode || health?.defaultApprovalMode || "smart";

  // Replay: rebuild the view from the first `cursor` events (docs/04 "Replay").
  const run: RunView = useMemo(() => (cursor === null ? live.run : live.events.slice(0, cursor).reduce(reduceRun, emptyRun())), [cursor, live]);

  const refreshRuns = useCallback(async () => {
    const res = await fetch("/api/runs").catch(() => null);
    if (res?.ok) setRuns(await res.json());
  }, []);

  useEffect(() => {
    refreshRuns();
    const timer = setInterval(refreshRuns, 3000);
    return () => clearInterval(timer);
  }, [refreshRuns]);

  const active = activeStep(run);
  useEffect(() => {
    if (!follow) return;
    if (active) setSelection({ kind: "step", id: active });
    else if (run.status === "completed" || run.status === "failed") setSelection({ kind: "answer" });
  }, [active, run.status, follow]);

  function openRun(id: string) {
    setRunId(id);
    setSelection(null);
    setFollow(true);
    setCursor(null);
    window.history.replaceState(null, "", `#/runs?run=${id}`);
  }

  function select(s: Selection) {
    setSelection(s);
    setFollow(false);
  }

  function setViewMode(v: "graph" | "stage") {
    setView(v);
    save(VIEW_KEY, { view: v });
  }

  function setOption(patch: Partial<typeof opts>) {
    const next = { ...opts, ...patch };
    setOpts(next);
    save(OPTS_KEY, next);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const body = await api<{ runId: string }>("/api/runs", { body: { prompt, profile, approvalMode } });
      openRun(body.runId);
      setPrompt("");
      refreshRuns();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  const decide = useCallback(
    (approvalId: string, decision: "approve" | "approve_run" | "reject") => {
      if (!runId) return;
      const note = decision === "reject" ? (window.prompt("Optional note for the agent (why rejected)?") ?? "") : "";
      api(`/api/runs/${runId}/approvals/${approvalId}`, { body: { decision, note } }).catch((err) => setError(errorText(err)));
    },
    [runId],
  );

  const control = (action: "cancel" | "pause" | "resume") => runId && api(`/api/runs/${runId}/${action}`, { body: {} }).catch((err) => setError(errorText(err)));
  const disabled = health?.canStartRuns === false;
  const replaying = cursor !== null;

  return (
    <div className="runs-page">
      <aside className="sidebar">
        <div className="sidebar-title">Runs</div>
        {runs.length === 0 && <p className="muted small">No runs yet.</p>}
        {runs.map((r) => (
          <button key={r.id} className={`run-item ${r.id === runId ? "active" : ""}`} onClick={() => openRun(r.id)}>
            <span className={`dot dot-${r.status}`} />
            <span className="run-prompt">{r.prompt}</span>
            <span className="muted small">{r.source === "observer" ? "observer" : usd(r.costUsd)}</span>
          </button>
        ))}
      </aside>

      <main className="canvas-area">
        {!runId ? (
          <Empty />
        ) : (
          <>
            <RunBar
              run={run}
              follow={follow}
              view={view}
              replaying={replaying}
              onView={setViewMode}
              onFollow={() => setFollow(true)}
              onControl={control}
              runId={runId}
            />
            {!replaying && run.pending.length > 0 && <ApprovalBar run={run} onDecide={decide} onOpen={(stepId) => select({ kind: "step", id: stepId })} />}
            {view === "stage" ? (
              <Stage key={runId} run={run} hud={false} />
            ) : (
              <Canvas
                run={run}
                selected={selection?.kind === "step" ? selection.id : null}
                onSelectStep={(id) => select({ kind: "step", id })}
                onSelectEdge={(e) => select({ kind: "edge", ...e })}
              />
            )}
            {live.run.status !== "running" && live.run.status !== "connecting" && live.events.length > 0 && (
              <ReplayBar
                events={live.events}
                cursor={cursor}
                onCursor={(c) => {
                  setCursor(c);
                  setFollow(true);
                }}
              />
            )}
          </>
        )}
      </main>

      <section className="side-panel">
        {runId ? <Inspector run={run} runId={runId} selection={selection} onSelect={select} onDecide={decide} /> : <Roster health={health} />}
      </section>

      <form className="composer" onSubmit={send}>
        <textarea
          value={prompt}
          placeholder={disabled ? "Runs are disabled in this AUTH_MODE" : "Give the company a task… (Ctrl+Enter to send)"}
          disabled={disabled}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(e);
          }}
        />
        <div className="composer-side">
          <div className="segmented" role="group" aria-label="Approval mode">
            {(["manual", "smart", "auto"] as const).map((m) => (
              <button type="button" key={m} className={approvalMode === m ? `active mode-${m}` : ""} onClick={() => setOption({ approvalMode: m })} title={MODE_HELP[m]}>
                {m}
              </button>
            ))}
          </div>
          <div className="composer-row">
            <select value={profile} onChange={(e) => setOption({ profile: e.target.value as Profile })} title="Cost profile">
              {(["eco", "balanced", "max"] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                  {health ? ` · $${health.profiles[p].budgetUsd}` : ""}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!prompt.trim() || sending || disabled}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
        {error && <div className="error small">{error}</div>}
      </form>

      {!replaying && run.pending.some((p) => p.kind === "plan") && <PlanApproval run={run} onDecide={decide} />}
    </div>
  );
}

const MODE_HELP: Record<ApprovalMode, string> = {
  manual: "Approve the plan first, and every risky action",
  smart: "Plan runs on its own; risky actions ask",
  auto: "Auto-approve everything except the never-auto list (sandbox and budgets still apply)",
};

function RunBar(p: {
  run: RunView;
  runId: string;
  follow: boolean;
  view: "graph" | "stage";
  replaying: boolean;
  onView: (v: "graph" | "stage") => void;
  onFollow: () => void;
  onControl: (a: "cancel" | "pause" | "resume") => void;
}) {
  const { run } = p;
  const u = totalUsage(run);
  const live = run.status === "running";
  return (
    <div className="run-bar">
      <span className={`status status-${run.paused ? "paused" : run.status}`}>{p.replaying ? "replay" : run.paused ? "paused" : run.status}</span>
      {run.approvalMode === "auto" && live && !p.replaying && <span className="chip chip-auto">AUTO-APPROVE</span>}
      {run.profile && <span className="chip">{run.profile}</span>}
      {run.mode === "workflow" && <span className="chip">workflow</span>}
      <span className="run-bar-prompt" title={run.prompt}>
        {run.prompt}
      </span>
      <span className="nums" title="input / output / cache-read tokens">
        ⬆{tokens(u.inputTokens)} ⬇{tokens(u.outputTokens)} ⟳{tokens(u.cacheReadTokens)}
      </span>
      <span className="nums">
        {usd(run.costUsd) || "$0"}
        {run.budgetUsd !== null && <span className="muted">/${run.budgetUsd.toFixed(2)}</span>}
      </span>
      {run.durationMs !== undefined && <span className="muted nums">{seconds(run.durationMs)}</span>}
      <div className="segmented small-seg">
        <button className={p.view === "graph" ? "active" : ""} onClick={() => p.onView("graph")} title="Node graph">
          Graph
        </button>
        <button className={p.view === "stage" ? "active" : ""} onClick={() => p.onView("stage")} title="Animated robot stage">
          Stage
        </button>
      </div>
      <button
        className="ghost"
        title="Open the stage in a new window (second monitor / OBS)"
        onClick={() => window.open(`#/stage?run=${p.runId}`, "claudestra-stage", "width=1280,height=720")}
      >
        ↗
      </button>
      {!p.follow && (
        <button className="ghost" onClick={p.onFollow} title="Follow the active agent">
          Follow
        </button>
      )}
      {live && !p.replaying && (
        <>
          <button className="ghost" onClick={() => p.onControl(run.paused ? "resume" : "pause")}>
            {run.paused ? "Resume" : "Pause"}
          </button>
          <button className="ghost" onClick={() => p.onControl("cancel")}>
            Stop
          </button>
        </>
      )}
    </div>
  );
}

function ApprovalBar({ run, onDecide, onOpen }: { run: RunView; onDecide: (id: string, d: "approve" | "approve_run" | "reject") => void; onOpen: (stepId: string) => void }) {
  const tools = run.pending.filter((p) => p.kind === "tool");
  if (tools.length === 0) return null;
  return (
    <div className="approval-bar">
      {tools.map((p) => {
        if (p.kind !== "tool") return null;
        const agent = agentFor(run, p.agentId);
        const input = p.input as Record<string, unknown>;
        const what = typeof input?.command === "string" ? input.command : typeof input?.file_path === "string" ? shortPath(input.file_path) : JSON.stringify(input).slice(0, 120);
        return (
          <div key={p.approvalId} className="approval-row">
            <button className="linkish" onClick={() => onOpen(p.stepId)} style={{ color: agent.color }}>
              {agent.name}
            </button>
            <span>
              wants <strong>{p.tool}</strong>: <code>{what}</code>
            </span>
            <span className="muted small">{p.reason}</span>
            <ApprovalButtons onDecide={(d) => onDecide(p.approvalId, d)} />
          </div>
        );
      })}
    </div>
  );
}

function PlanApproval({ run, onDecide }: { run: RunView; onDecide: (id: string, d: "approve" | "approve_run" | "reject") => void }) {
  const pending = run.pending.find((p) => p.kind === "plan");
  if (!pending || !run.plan) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Approve the plan?</h3>
        <p className="muted">{run.plan.summary}</p>
        <ol className="plan-list">
          {run.plan.steps.map((s) => {
            const agent = agentFor(run, s.agent);
            return (
              <li key={s.id}>
                <strong style={{ color: agent.color }}>{agent.name}</strong> <span className="muted small">({s.id}{s.dependsOn.length ? ` ← ${s.dependsOn.join(", ")}` : ""})</span>
                <div className="small">{s.task}</div>
              </li>
            );
          })}
        </ol>
        <ApprovalButtons allowRun={false} onDecide={(d) => onDecide(pending.approvalId, d)} />
      </div>
    </div>
  );
}

function ReplayBar({ events, cursor, onCursor }: { events: ClaudestraEvent[]; cursor: number | null; onCursor: (c: number | null) => void }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const pos = cursor ?? events.length;
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    if (!playing) return;
    // Replays at a steady event rate; speed multiplies it. No re-execution, no cost.
    const timer = setInterval(() => {
      // 1× replays the whole run in about 70 s, whatever its length.
      const next = Math.min(posRef.current + Math.max(1, Math.round((speed * events.length) / 600)), events.length);
      onCursor(next >= events.length ? null : next);
      if (next >= events.length) setPlaying(false);
    }, 120);
    return () => clearInterval(timer);
  }, [playing, speed, events.length, onCursor]);

  return (
    <div className="replay-bar">
      <button
        className="ghost"
        onClick={() => {
          if (!playing && pos >= events.length) onCursor(1);
          setPlaying(!playing);
        }}
      >
        {playing ? "⏸" : "▶"} Replay
      </button>
      <input type="range" min={1} max={events.length} value={pos} onChange={(e) => onCursor(Number(e.target.value) >= events.length ? null : Number(e.target.value))} />
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
        {[1, 4, 16].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <span className="muted small nums">
        {pos}/{events.length}
      </span>
      {cursor !== null && (
        <button className="ghost" onClick={() => (setPlaying(false), onCursor(null))}>
          Live
        </button>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="empty">
      <h1>Your AI company</h1>
      <p className="muted">
        Send a task below. The CEO decides who is needed (often nobody but itself), the plan appears as a graph, and each agent lights up while it works.
        Switch to <strong>Stage</strong> to watch a little robot carry the work between desks, or pop it out to a second monitor.
      </p>
    </div>
  );
}

function Roster({ health }: { health: HealthResponse | null }) {
  if (!health) return null;
  const models = health.profiles[health.defaultProfile].models;
  return (
    <div className="inspector">
      <div className="inspector-body">
        <h3 className="insp-title">Team</h3>
        {health.agents.map((a) => (
          <div key={a.id} className="roster-item" style={{ borderColor: a.color }}>
            <strong style={{ color: a.color }}>{a.name}</strong>{" "}
            <span className="muted small">
              · {a.modelClass} · {models[a.modelClass]}
            </span>
            <div className="small muted">{a.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
