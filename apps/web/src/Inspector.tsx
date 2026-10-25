import type { RunView } from "./run-state.ts";
import { agentFor } from "./graph.ts";
import { iconFor } from "./icons.ts";
import { Timeline } from "./Timeline.tsx";
import { seconds, tokens, usd } from "./format.ts";

export type Selection = { kind: "step"; id: string } | { kind: "edge"; from: string; to: string } | { kind: "answer" } | null;

export function Inspector({ run, selection, onSelect }: { run: RunView; selection: Selection; onSelect: (s: Selection) => void }) {
  const hasAnswer = run.status === "completed" || run.status === "failed";
  return (
    <div className="inspector">
      <div className="tabs">
        <button className={selection?.kind !== "answer" ? "active" : ""} onClick={() => onSelect(run.order[0] ? { kind: "step", id: run.order[0] } : null)}>
          Step
        </button>
        <button className={selection?.kind === "answer" ? "active" : ""} disabled={!hasAnswer} onClick={() => onSelect({ kind: "answer" })}>
          Answer
        </button>
      </div>
      <div className="inspector-body">{body(run, selection)}</div>
    </div>
  );
}

function body(run: RunView, selection: Selection) {
  if (selection?.kind === "answer") {
    if (run.status === "failed") return <div className="error">{run.error}</div>;
    return (
      <>
        <div className="answer">{run.answer}</div>
        <div className="muted small answer-meta">
          {usd(run.costUsd)} · {run.durationMs !== undefined && seconds(run.durationMs)} · {Object.keys(run.steps).length} steps
          {run.plan && ` · route ${run.plan.route}`}
        </div>
      </>
    );
  }
  if (selection?.kind === "edge") {
    const handoff = run.handoffs.find((h) => h.from === selection.from && h.to === selection.to);
    return (
      <>
        <h3 className="insp-title">
          {selection.from} → {selection.to}
        </h3>
        {handoff ? <pre className="card">{handoff.summary}</pre> : <p className="muted small">No handoff yet; it appears when {selection.to} starts.</p>}
      </>
    );
  }
  const step = selection?.kind === "step" ? run.steps[selection.id] : undefined;
  if (!step) return <p className="muted small">Click a node to see what that agent is doing.</p>;
  const agent = agentFor(run, step.agentId);
  const planStep = run.plan?.steps.find((s) => s.id === step.id);
  return (
    <>
      <h3 className="insp-title" style={{ color: agent.color }}>
        {iconFor(agent.icon)} {agent.name} <span className="muted small">· {step.id} · {step.status}</span>
      </h3>
      <div className="insp-meta small muted">
        {step.model && <span>{step.model}</span>}
        <span>
          ⬆ {tokens(step.usage.inputTokens)} ⬇ {tokens(step.usage.outputTokens)} ⟳ {tokens(step.usage.cacheReadTokens)}
        </span>
        {step.costUsd !== null && <span>{usd(step.costUsd)}</span>}
      </div>
      {step.task && (
        <div className="card task">
          <div className="small muted">Task</div>
          {step.task}
          {planStep?.successCriteria && <div className="small muted">Success: {planStep.successCriteria}</div>}
        </div>
      )}
      {step.note && <div className="denied small">{step.note}</div>}
      <Timeline items={step.items} />
    </>
  );
}
