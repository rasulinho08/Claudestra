import { useState } from "react";
import type { HealthResponse } from "@claudestra/protocol";
import { Markdown } from "./Markdown.tsx";
import { ResultsBar } from "./ResultsBar.tsx";
import type { RunView } from "./run-state.ts";
import { agentFor } from "./graph.ts";
import { iconFor } from "./icons.ts";
import { Timeline, type Decide } from "./Timeline.tsx";
import { FilesPanel } from "./FilesPanel.tsx";
import { seconds, tokens, usd } from "./format.ts";
import { api, errorText } from "./api.ts";
import { go } from "./router.ts";
import { t, type Key } from "./i18n.ts";

// SDK apiKeySource values → readable labels ("none" means the claude.ai login, not "no auth").
const AUTH_LABEL: Record<string, string> = {
  ANTHROPIC_API_KEY: "API key",
  none: "Claude login",
  "/login managed key": "Console login key",
  apiKeyHelper: "API key helper",
  gemini: "Gemini key",
  meta: "Meta key",
  openai_compat: "OpenAI-compatible key",
  demo: "demo",
};

export type Selection = { kind: "step"; id: string } | { kind: "edge"; from: string; to: string } | { kind: "answer" } | { kind: "files" } | null;

type Props = { run: RunView; runId: string; health: HealthResponse | null; selection: Selection; onSelect: (s: Selection) => void; onDecide: Decide };

export function Inspector({ run, runId, health, selection, onSelect, onDecide }: Props) {
  const hasAnswer = run.status === "completed" || run.status === "failed";
  const refreshKey = run.status === "running" ? Math.floor(run.lastSeq / 25) : run.lastSeq;
  const tab = selection?.kind === "answer" ? "answer" : selection?.kind === "files" ? "files" : "step";
  return (
    <div className="inspector">
      <div className="tabs">
        <button className={tab === "step" ? "active" : ""} onClick={() => onSelect(run.order[0] ? { kind: "step", id: run.order[0] } : null)}>
          {t("insp.step")}
        </button>
        <button className={tab === "files" ? "active" : ""} onClick={() => onSelect({ kind: "files" })}>
          {t("insp.files")}
        </button>
        <button className={tab === "answer" ? "active" : ""} disabled={!hasAnswer} onClick={() => onSelect({ kind: "answer" })}>
          {t("insp.answer")}
        </button>
      </div>
      <div className="inspector-body">
        {tab === "files" ? (
          <>
            <ResultsBar runId={runId} prompt={run.prompt} health={health} refreshKey={refreshKey} />
            <FilesPanel runId={runId} health={health} refreshKey={refreshKey} />
          </>
        ) : (
          body(run, runId, health, selection, onDecide)
        )}
      </div>
    </div>
  );
}

function SaveWorkflow({ runId }: { runId: string }) {
  const [state, setState] = useState<{ text: string; saved: boolean } | null>(null);
  async function save() {
    const name = window.prompt(t("insp.workflowName"), t("insp.myWorkflow"));
    if (!name) return;
    try {
      await api("/api/workflows", { body: { fromRunId: runId, name } });
      setState({ text: t("insp.saved"), saved: true });
    } catch (err) {
      setState({ text: errorText(err), saved: false });
    }
  }
  return (
    <div className="save-wf">
      <button className="ghost" onClick={save}>
        {t("insp.saveWorkflow")}
      </button>
      {state && (
        <span className="small muted">
          {state.text}{" "}
          {state.saved && (
            <a href="#/workflows" onClick={() => go("workflows")}>
              {t("insp.toWorkflows")}
            </a>
          )}
        </span>
      )}
    </div>
  );
}

function body(run: RunView, runId: string, health: HealthResponse | null, selection: Selection, onDecide: Decide) {
  if (selection?.kind === "answer") {
    if (run.status === "failed") return <div className="error">{run.error}</div>;
    return (
      <>
        <ResultsBar runId={runId} prompt={run.prompt} health={health} refreshKey={run.lastSeq} />
        <Markdown className="answer" text={run.answer ?? ""} />
        <div className="muted small answer-meta">
          {usd(run.costUsd)} · {run.durationMs !== undefined && seconds(run.durationMs)} · {t("insp.steps", { n: Object.keys(run.steps).length })}
          {run.plan && ` · ${t("insp.route", { route: run.plan.route })}`}
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
        {handoff ? <pre className="card">{handoff.summary}</pre> : <p className="muted small">{t("insp.noHandoff", { id: selection.to })}</p>}
      </>
    );
  }
  const step = selection?.kind === "step" ? run.steps[selection.id] : undefined;
  if (!step) return <p className="muted small">{t("insp.pick")}</p>;
  const agent = agentFor(run, step.agentId);
  const planStep = run.plan?.steps.find((s) => s.id === step.id);
  return (
    <>
      <h3 className="insp-title" style={{ color: agent.color }}>
        {iconFor(agent.icon)} {agent.name}{" "}
        <span className="muted small">
          · {step.id} · {t(`step.${step.status}` as Key)}
          {step.iteration ? ` · ${t("insp.round", { n: step.iteration })}` : ""}
          {step.attempt && step.attempt > 1 ? ` · ${t("insp.attempt", { n: step.attempt })}` : ""}
        </span>
      </h3>
      <div className="insp-meta small muted">
        {step.model && <span>{step.model}</span>}
        {step.authSource && <span title={t("insp.authTitle")}>{t("insp.auth", { source: AUTH_LABEL[step.authSource] ?? step.authSource })}</span>}
        <span>
          ⬆ {tokens(step.usage.inputTokens)} ⬇ {tokens(step.usage.outputTokens)} ⟳ {tokens(step.usage.cacheReadTokens)}
        </span>
        {step.costUsd !== null && <span>{usd(step.costUsd)}</span>}
        {step.skills.length > 0 && <span>{t("insp.skills", { list: step.skills.join(", ") })}</span>}
      </div>
      {step.task && (
        <div className="card task">
          <div className="small muted">{t("insp.task")}</div>
          {step.task}
          {planStep?.successCriteria && <div className="small muted">{t("insp.success", { text: planStep.successCriteria })}</div>}
          {planStep?.loopBackTo && <div className="small muted">{t("insp.loop", { id: planStep.loopBackTo })}</div>}
        </div>
      )}
      {step.note && <div className="denied small">{step.note}</div>}
      <Timeline items={step.items} onDecide={onDecide} />
    </>
  );
}
