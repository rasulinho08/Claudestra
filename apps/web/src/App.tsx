import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { HealthResponse, RunSummary } from "@claudestra/protocol";
import { useRunEvents } from "./useRunEvents.ts";
import { activeStep, totalUsage, type RunView } from "./run-state.ts";
import { Canvas } from "./Canvas.tsx";
import { Inspector, type Selection } from "./Inspector.tsx";
import { seconds, tokens, usd } from "./format.ts";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [follow, setFollow] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const run = useRunEvents(runId);

  const refreshRuns = useCallback(async () => {
    const res = await fetch("/api/runs").catch(() => null);
    if (res?.ok) setRuns(await res.json());
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError("Server is not reachable on :8787. Start it with `npm run dev`."));
    refreshRuns();
    const timer = setInterval(refreshRuns, 3000);
    return () => clearInterval(timer);
  }, [refreshRuns]);

  // Follow the active agent; show the answer when the run ends.
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
  }

  function select(s: Selection) {
    setSelection(s);
    setFollow(false);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      openRun(body.runId);
      setPrompt("");
      refreshRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const disabled = health?.canStartRuns === false;

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Claudestra</strong>
        {health && (
          <span className={`badge ${health.canStartRuns ? "" : "badge-warn"}`} title={`models: ${Object.entries(health.models).map(([k, v]) => `${k}=${v}`).join(", ")}`}>
            {health.authMode} · {health.agents.length} agents
          </span>
        )}
        {runId && <RunStats run={run} follow={follow} onFollow={() => setFollow(true)} onCancel={() => fetch(`/api/runs/${runId}/cancel`, { method: "POST" })} />}
      </header>

      {(health?.warning || run.budgetWarning) && <div className="banner">{run.budgetWarning ?? health?.warning}</div>}

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
            {run.prompt && <div className="run-prompt-bar">{run.prompt}</div>}
            <Canvas
              run={run}
              selected={selection?.kind === "step" ? selection.id : null}
              onSelectStep={(id) => select({ kind: "step", id })}
              onSelectEdge={(e) => select({ kind: "edge", ...e })}
            />
          </>
        )}
      </main>

      <section className="side-panel">{runId ? <Inspector run={run} selection={selection} onSelect={select} /> : <Roster health={health} />}</section>

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
        <button type="submit" disabled={!prompt.trim() || sending || disabled}>
          {sending ? "Sending…" : "Send"}
        </button>
        {error && <div className="error small">{error}</div>}
      </form>
    </div>
  );
}

function RunStats({ run, follow, onFollow, onCancel }: { run: RunView; follow: boolean; onFollow: () => void; onCancel: () => void }) {
  const u = totalUsage(run);
  return (
    <div className="stats">
      <span className={`status status-${run.status}`}>{run.status}</span>
      <span title="input / output / cache read tokens">
        ⬆ {tokens(u.inputTokens)} ⬇ {tokens(u.outputTokens)} ⟳ {tokens(u.cacheReadTokens)}
      </span>
      <span>
        {usd(run.costUsd) || "$0"}
        {run.budgetUsd !== null && <span className="muted"> / ${run.budgetUsd.toFixed(2)}</span>}
      </span>
      {run.durationMs !== undefined && <span className="muted">{seconds(run.durationMs)}</span>}
      {!follow && (
        <button className="ghost" onClick={onFollow} title="Follow the active agent">
          Follow
        </button>
      )}
      {run.status === "running" && (
        <button className="ghost" onClick={onCancel}>
          Stop
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
        Send a task below. The CEO decides who is needed (often nobody but itself), the plan appears as a graph, and each
        agent lights up while it works. Click a node to watch it; click an edge to see what was handed over.
      </p>
    </div>
  );
}

function Roster({ health }: { health: HealthResponse | null }) {
  if (!health) return null;
  return (
    <div className="inspector">
      <div className="inspector-body">
        <h3 className="insp-title">Team</h3>
        {health.agents.map((a) => (
          <div key={a.id} className="roster-item" style={{ borderColor: a.color }}>
            <strong style={{ color: a.color }}>{a.name}</strong> <span className="muted small">· {a.modelClass} · {health.models[a.modelClass]}</span>
            <div className="small muted">{a.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
