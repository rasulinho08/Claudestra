import { useState } from "react";
import type { RunView } from "./run-state.ts";
import { agentFor } from "./graph.ts";
import { iconFor } from "./icons.ts";
import { Timeline, type Decide } from "./Timeline.tsx";
import { FilesPanel } from "./FilesPanel.tsx";
import { seconds, tokens, usd } from "./format.ts";
import { api, errorText } from "./api.ts";
import { go } from "./router.ts";

// SDK apiKeySource values → readable labels ("none" means the claude.ai login, not "no auth").
const AUTH_LABEL: Record<string, string> = {
  ANTHROPIC_API_KEY: "API key",
  none: "Claude login",
  "/login managed key": "Console login key",
  apiKeyHelper: "API key helper",
  gemini: "Gemini key",
  demo: "demo",
};

export type Selection = { kind: "step"; id: string } | { kind: "edge"; from: string; to: string } | { kind: "answer" } | { kind: "files" } | null;

type Props = { run: RunView; runId: string; selection: Selection; onSelect: (s: Selection) => void; onDecide: Decide };

export function Inspector({ run, runId, selection, onSelect, onDecide }: Props) {
  const hasAnswer = run.status === "completed" || run.status === "failed";
  const tab = selection?.kind === "answer" ? "answer" : selection?.kind === "files" ? "files" : "step";
  return (
    <div className="inspector">
      <div className="tabs">
        <button className={tab === "step" ? "active" : ""} onClick={() => onSelect(run.order[0] ? { kind: "step", id: run.order[0] } : null)}>
          Step
        </button>
        <button className={tab === "files" ? "active" : ""} onClick={() => onSelect({ kind: "files" })}>
          Files
        </button>
        <button className={tab === "answer" ? "active" : ""} disabled={!hasAnswer} onClick={() => onSelect({ kind: "answer" })}>
          Answer
        </button>
      </div>
      <div className="inspector-body">
        {tab === "files" ? <FilesPanel runId={runId} refreshKey={run.status === "running" ? Math.floor(run.lastSeq / 25) : run.lastSeq} /> : body(run, runId, selection, onDecide)}
      </div>
    </div>
  );
}

function SaveWorkflow({ runId }: { runId: string }) {
  const [state, setState] = useState<string | null>(null);
  async function save() {
    const name = window.prompt("Name for this workflow", "My workflow");
    if (!name) return;
    try {
      await api("/api/workflows", { body: { fromRunId: runId, name } });
      setState("Saved. Open Workflows to run it again.");
    } catch (err) {
      setState(errorText(err));
    }
  }
  return (
    <div className="save-wf">
      <button className="ghost" onClick={save}>
        ☆ Save as workflow
      </button>
      {state && (
        <span className="small muted">
          {state}{" "}
          {state.startsWith("Saved") && (
            <a href="#/workflows" onClick={() => go("workflows")}>
              Workflows →
            </a>
          )}
        </span>
      )}
    </div>
  );
}

function body(run: RunView, runId: string, selection: Selection, onDecide: Decide) {
  if (selection?.kind === "answer") {
    if (run.status === "failed") return <div className="error">{run.error}</div>;
    return (
      <>
        <div className="answer">{run.answer}</div>
        <div className="muted small answer-meta">
          {usd(run.costUsd)} · {run.durationMs !== undefined && seconds(run.durationMs)} · {Object.keys(run.steps).length} steps
          {run.plan && ` · route ${run.plan.route}`}
          {run.profile && ` · ${run.profile}`}
        </div>
        {run.plan?.route === "team" && run.mode !== "workflow" && <SaveWorkflow runId={runId} />}
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
        {iconFor(agent.icon)} {agent.name}{" "}
        <span className="muted small">
          · {step.id} · {step.status.replace("_", " ")}
          {step.iteration ? ` · round ${step.iteration}` : ""}
          {step.attempt && step.attempt > 1 ? ` · attempt ${step.attempt}` : ""}
        </span>
      </h3>
      <div className="insp-meta small muted">
        {step.model && <span>{step.model}</span>}
        {step.authSource && <span title="Credential the engine used for this step">auth: {AUTH_LABEL[step.authSource] ?? step.authSource}</span>}
        <span>
          ⬆ {tokens(step.usage.inputTokens)} ⬇ {tokens(step.usage.outputTokens)} ⟳ {tokens(step.usage.cacheReadTokens)}
        </span>
        {step.costUsd !== null && <span>{usd(step.costUsd)}</span>}
        {step.skills.length > 0 && <span>skills: {step.skills.join(", ")}</span>}
      </div>
      {step.task && (
        <div className="card task">
          <div className="small muted">Task</div>
          {step.task}
          {planStep?.successCriteria && <div className="small muted">Success: {planStep.successCriteria}</div>}
          {planStep?.loopBackTo && <div className="small muted">Sends {planStep.loopBackTo} back for fixes if it requests changes</div>}
        </div>
      )}
      {step.note && <div className="denied small">{step.note}</div>}
      <Timeline items={step.items} onDecide={onDecide} />
    </>
  );
}
