import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { HealthResponse, RunSummary } from "@claudestra/protocol";
import { useRunEvents } from "./useRunEvents.ts";
import type { RunView, TimelineItem } from "./run-state.ts";

const usd = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `$${v.toFixed(4)}`);
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const run = useRunEvents(selected);

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

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSelected(body.runId);
      setPrompt("");
      refreshRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function cancel() {
    if (selected) await fetch(`/api/runs/${selected}/cancel`, { method: "POST" });
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Claudestra</strong>
        {health && (
          <span className={`badge ${health.canStartRuns ? "" : "badge-warn"}`} title={health.warning}>
            {health.authMode} · {health.model}
          </span>
        )}
        {selected && <RunStats run={run} onCancel={cancel} />}
      </header>

      {health?.warning && <div className="banner">{health.warning}</div>}

      <aside className="sidebar">
        <div className="sidebar-title">Runs</div>
        {runs.length === 0 && <p className="muted small">No runs yet.</p>}
        {runs.map((r) => (
          <button key={r.id} className={`run-item ${r.id === selected ? "active" : ""}`} onClick={() => setSelected(r.id)}>
            <span className={`dot dot-${r.status}`} />
            <span className="run-prompt">{r.prompt}</span>
            <span className="muted small">{r.source === "observer" ? "observer" : usd(r.costUsd)}</span>
          </button>
        ))}
      </aside>

      <main className="main">
        {!selected ? <Empty /> : <Timeline run={run} />}
      </main>

      <form className="composer" onSubmit={send}>
        <textarea
          value={prompt}
          placeholder={health?.canStartRuns === false ? "Runs are disabled in this AUTH_MODE" : "Ask the agent… (Ctrl+Enter to send)"}
          disabled={health?.canStartRuns === false}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(e);
          }}
        />
        <button type="submit" disabled={!prompt.trim() || sending || health?.canStartRuns === false}>
          {sending ? "Sending…" : "Send"}
        </button>
        {error && <div className="error small">{error}</div>}
      </form>
    </div>
  );
}

function RunStats({ run, onCancel }: { run: RunView; onCancel: () => void }) {
  const u = run.usage;
  return (
    <div className="stats">
      <span className={`status status-${run.status}`}>{run.status}</span>
      <span title="input / output / cache read tokens">
        ⬆ {tokens(u.inputTokens)} ⬇ {tokens(u.outputTokens)} ⟳ {tokens(u.cacheReadTokens)}
      </span>
      <span>
        {usd(run.costUsd)}
        {run.budgetUsd !== null && <span className="muted"> / ${run.budgetUsd.toFixed(2)}</span>}
      </span>
      {run.durationMs !== undefined && <span className="muted">{(run.durationMs / 1000).toFixed(1)}s</span>}
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
      <h1>Phase 0</h1>
      <p className="muted">
        Send a prompt below to watch one agent work live: messages stream in, tool calls appear with their results, and
        tokens and cost update as it goes. In observer mode, your Claude Code sessions show up in the list on the left.
      </p>
    </div>
  );
}

function Timeline({ run }: { run: RunView }) {
  return (
    <div className="timeline">
      {run.prompt && <div className="prompt">{run.prompt}</div>}
      {run.model && (
        <div className="muted small">
          model {run.model}
          {run.apiKeySource && ` · auth ${run.apiKeySource}`}
        </div>
      )}
      {run.items.map((item) => (
        <Item key={`${item.kind}-${item.id}`} item={item} />
      ))}
      {run.status === "running" && <div className="pulse">working…</div>}
    </div>
  );
}

function Item({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "message":
      return <div className={`msg msg-${item.role} ${item.streaming ? "streaming" : ""}`}>{item.text}</div>;
    case "thinking":
      return (
        <details className="thinking">
          <summary>thinking</summary>
          <pre>{item.text}</pre>
        </details>
      );
    case "tool":
      return (
        <details className={`tool ${item.result ? (item.result.ok ? "ok" : "fail") : "pending"}`}>
          <summary>
            <span className="tool-icon">{item.result ? (item.result.ok ? "✓" : "✗") : "…"}</span> {item.tool}
            <span className="muted small"> {preview(item.input)}</span>
          </summary>
          <pre>{JSON.stringify(item.input, null, 2)}</pre>
          {item.result && (
            <pre className="tool-output">
              {item.result.output}
              {item.result.truncated && "\n[truncated]"}
            </pre>
          )}
        </details>
      );
    case "denied":
      return (
        <div className="denied small">
          ⛔ {item.tool} denied: {item.reason}
        </div>
      );
    case "error":
      return <div className="error">{item.text}</div>;
  }
}

function preview(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const first = Object.values(input as Record<string, unknown>).find((v) => typeof v === "string") as string | undefined;
  return first ? (first.length > 60 ? `${first.slice(0, 60)}…` : first) : "";
}
