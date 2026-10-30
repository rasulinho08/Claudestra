// Pure reducer: run view state is derived only from protocol events (docs/07 "Design principles").
import { CEO_FINAL_STEP, emptyUsage, type AgentInfo, type ApprovalMode, type ClaudestraEvent, type Plan, type Profile, type RunStatus, type StepStatus, type Usage } from "@claudestra/protocol";

export type TimelineItem =
  | { kind: "message"; id: string; role: "assistant" | "user" | "system"; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; tool: string; input: unknown; result?: { ok: boolean; output: string; truncated: boolean } }
  | { kind: "denied"; id: string; tool: string; reason: string }
  | { kind: "handoff"; id: string; from: string; summary: string }
  | { kind: "artifact"; id: string; title: string; path: string }
  | { kind: "approval"; id: string; tool: string; input: unknown; reason: string; state: "pending" | "approved" | "rejected"; by?: string; scope?: string; note?: string }
  | { kind: "note"; id: string; text: string }
  | { kind: "error"; id: string; text: string };

export type StepView = {
  id: string;
  agentId: string;
  task: string;
  status: StepStatus;
  model?: string;
  // Which credential the engine used (SDK apiKeySource): "ANTHROPIC_API_KEY", "none" (claude.ai login), "gemini", "demo".
  authSource?: string;
  items: TimelineItem[];
  usage: Usage;
  costUsd: number | null;
  lastTool?: string;
  startedAt?: string;
  endedAt?: string;
  note?: string;
  // Extra dependencies for steps added during the run (verifier loops).
  dependsOn?: string[];
  loopOf?: string;
  iteration?: number;
  attempt?: number;
  skills: string[];
};

export type PendingApproval =
  | { kind: "plan"; approvalId: string }
  | { kind: "tool"; approvalId: string; stepId: string; agentId: string; tool: string; input: unknown; reason: string };

export type Handoff = { from: string; to: string; summary: string };

export type RunView = {
  lastSeq: number;
  prompt: string;
  source?: "claudestra" | "observer";
  status: RunStatus | "connecting";
  budgetUsd: number | null;
  agents: Record<string, AgentInfo>;
  plan?: Plan;
  steps: Record<string, StepView>;
  order: string[];
  handoffs: Handoff[];
  costUsd: number | null;
  durationMs?: number;
  answer?: string;
  error?: string;
  budgetWarning?: string;
  profile?: Profile;
  approvalMode?: ApprovalMode;
  mode?: "dynamic" | "workflow";
  paused: boolean;
  pending: PendingApproval[];
};

export const emptyRun = (): RunView => ({
  lastSeq: 0,
  prompt: "",
  status: "connecting",
  budgetUsd: null,
  agents: {},
  steps: {},
  order: [],
  handoffs: [],
  costUsd: null,
  paused: false,
  pending: [],
});

const TERMINAL_STEP: StepStatus[] = ["succeeded", "failed", "skipped", "cancelled"];

function ensureStep(state: RunView, id: string, agentId = "assistant", task = "") {
  if (state.steps[id]) return;
  state.steps = { ...state.steps, [id]: { id, agentId, task, status: "pending", items: [], usage: emptyUsage(), costUsd: null, skills: [] } };
  state.order = [...state.order, id];
}

function updateStep(state: RunView, id: string, patch: (s: StepView) => Partial<StepView>) {
  const step = state.steps[id];
  if (!step) return;
  state.steps = { ...state.steps, [id]: { ...step, ...patch(step) } };
}

function closeOpenSteps(state: RunView, running: StepStatus, pending: StepStatus) {
  for (const step of Object.values(state.steps)) {
    if (TERMINAL_STEP.includes(step.status)) continue;
    updateStep(state, step.id, (s) => ({ status: s.status === "running" ? running : pending }));
  }
}

export function reduceRun(state: RunView, event: ClaudestraEvent): RunView {
  if (event.seq <= state.lastSeq) return state;
  const next: RunView = { ...state, lastSeq: event.seq };
  const stepId = event.stepId;

  if (stepId) ensureStep(next, stepId, event.agentId);
  const push = (item: TimelineItem) => {
    if (stepId) updateStep(next, stepId, (s) => ({ items: [...s.items, item] }));
  };

  switch (event.type) {
    case "run.started":
      next.prompt = event.data.prompt;
      next.source = event.data.source;
      next.status = "running";
      next.budgetUsd = event.data.budgetUsd;
      next.agents = Object.fromEntries(event.data.agents.map((a) => [a.id, a]));
      next.profile = event.data.profile;
      next.approvalMode = event.data.approvalMode;
      next.mode = event.data.mode;
      break;
    case "run.paused":
      next.paused = true;
      break;
    case "run.resumed":
      next.paused = false;
      break;
    case "plan.approval_requested":
      next.pending = [...next.pending, { kind: "plan", approvalId: event.data.approvalId }];
      break;
    case "plan.approved":
    case "plan.rejected":
      next.pending = next.pending.filter((p) => p.approvalId !== event.data.approvalId);
      break;
    case "ceo.review": {
      const { stepId: target, action, note } = event.data;
      updateStep(next, target, (s) => ({ items: [...s.items, { kind: "note", id: `r-${event.seq}`, text: `CEO review: ${action}${note ? ` — ${note}` : ""}` }] }));
      break;
    }
    case "step.added":
      updateStep(next, stepId!, (s) => ({ task: event.data.task, dependsOn: event.data.dependsOn, loopOf: event.data.loopOf, iteration: event.data.iteration, agentId: event.data.agent || s.agentId }));
      break;
    case "step.retrying":
      updateStep(next, stepId!, (s) => ({
        status: "running",
        attempt: event.data.attempt,
        task: event.data.task,
        items: [...s.items, { kind: "note", id: `rt-${event.seq}`, text: `Retry ${event.data.attempt}${event.data.reason ? `: ${event.data.reason}` : ""}` }],
      }));
      break;
    case "step.approval_requested": {
      const { approvalId, tool, input, reason } = event.data;
      next.pending = [...next.pending, { kind: "tool", approvalId, stepId: stepId!, agentId: event.agentId ?? "", tool, input, reason }];
      updateStep(next, stepId!, (s) => ({ status: "waiting_approval", items: [...s.items, { kind: "approval", id: approvalId, tool, input, reason, state: "pending" }] }));
      break;
    }
    case "step.approved":
    case "step.rejected": {
      const { approvalId } = event.data;
      const approved = event.type === "step.approved";
      const wasPending = next.pending.some((p) => p.approvalId === approvalId);
      next.pending = next.pending.filter((p) => p.approvalId !== approvalId);
      updateStep(next, stepId!, (s) => {
        const patch = { state: approved ? ("approved" as const) : ("rejected" as const), by: event.data.by, scope: approved ? event.data.scope : undefined, note: approved ? undefined : event.data.note };
        const items = wasPending
          ? s.items.map((i) => (i.kind === "approval" && i.id === approvalId ? { ...i, ...patch } : i))
          : // Auto / rule approvals were never pending: log them directly.
            [...s.items, { kind: "approval" as const, id: approvalId, tool: approved ? event.data.tool : "", input: undefined, reason: approved ? event.data.reason : "", ...patch }];
        return { items, status: s.status === "waiting_approval" ? "running" : s.status };
      });
      break;
    }
    case "skill.loaded":
      updateStep(next, stepId!, (s) => ({ skills: s.skills.includes(event.data.name) ? s.skills : [...s.skills, event.data.name] }));
      push({ kind: "note", id: `sk-${event.seq}`, text: `Loaded skill: ${event.data.name}` });
      break;
    case "plan.created":
      next.plan = event.data.plan;
      for (const step of event.data.plan.steps) ensureStep(next, step.id, step.agent, step.task);
      if (event.data.plan.route === "team") ensureStep(next, CEO_FINAL_STEP, "ceo", "Write the final answer");
      break;
    case "step.ready":
      updateStep(next, stepId!, (s) => ({ status: s.status === "pending" ? "ready" : s.status, task: event.data.task || s.task }));
      break;
    case "step.started":
      updateStep(next, stepId!, (s) => ({ status: "running", task: s.task || event.data.task, model: event.data.model, authSource: event.data.apiKeySource ?? s.authSource, startedAt: event.ts }));
      break;
    case "step.message": {
      const { messageId, text, partial, role } = event.data;
      updateStep(next, stepId!, (s) => {
        const items = s.items.slice();
        const idx = items.findIndex((i) => i.kind === "message" && i.id === messageId);
        const existing = idx >= 0 ? (items[idx] as Extract<TimelineItem, { kind: "message" }>) : undefined;
        if (!existing) items.push({ kind: "message", id: messageId, role, text, streaming: partial });
        else if (partial) items[idx] = { ...existing, text: existing.text + text };
        // Final text replaces streamed deltas; further final blocks of the same message are appended.
        else items[idx] = { ...existing, text: existing.streaming ? text : `${existing.text}\n\n${text}`, streaming: false };
        return { items };
      });
      break;
    }
    case "step.thinking":
      push({ kind: "thinking", id: `th-${event.seq}`, text: event.data.text });
      break;
    case "step.handoff":
      next.handoffs = [...next.handoffs, event.data];
      push({ kind: "handoff", id: `h-${event.seq}`, from: event.data.from, summary: event.data.summary });
      break;
    case "tool.called":
      push({ kind: "tool", id: event.data.callId, tool: event.data.tool, input: event.data.input });
      updateStep(next, stepId!, () => ({ lastTool: event.data.tool }));
      break;
    case "tool.result": {
      const { callId, ok, output, truncated } = event.data;
      updateStep(next, stepId!, (s) => ({
        items: s.items.map((i) => (i.kind === "tool" && i.id === callId ? { ...i, result: { ok, output, truncated } } : i)),
      }));
      break;
    }
    case "tool.denied":
      push({ kind: "denied", id: `d-${event.seq}`, tool: event.data.tool, reason: event.data.reason });
      break;
    case "artifact.created":
      push({ kind: "artifact", id: event.data.id, title: event.data.title, path: event.data.path });
      break;
    case "usage.updated": {
      const { costUsd, runCostUsd, ...usage } = event.data;
      if (stepId) updateStep(next, stepId, (s) => ({ usage, costUsd: costUsd ?? s.costUsd }));
      if (runCostUsd !== null) next.costUsd = runCostUsd;
      break;
    }
    case "step.succeeded":
      updateStep(next, stepId!, (s) => ({ status: "succeeded", endedAt: event.ts, costUsd: event.data.costUsd ?? s.costUsd }));
      break;
    case "step.failed":
      updateStep(next, stepId!, (s) => ({ status: "failed", endedAt: event.ts, items: [...s.items, { kind: "error", id: `e-${event.seq}`, text: event.data.error }] }));
      break;
    case "step.skipped":
      updateStep(next, stepId!, () => ({ status: "skipped", note: event.data.reason }));
      break;
    case "step.cancelled":
      updateStep(next, stepId!, () => ({ status: "cancelled" }));
      break;
    case "budget.warning":
      next.budgetWarning = `80% of the $${event.data.limitUsd.toFixed(2)} budget used`;
      break;
    case "budget.exceeded":
      next.budgetWarning = `Budget of $${event.data.limitUsd.toFixed(2)} reached; remaining steps skipped`;
      break;
    case "run.completed":
      next.status = "completed";
      next.pending = [];
      next.paused = false;
      next.answer = event.data.answer;
      next.durationMs = event.data.durationMs;
      if (event.data.totalCostUsd !== null) next.costUsd = event.data.totalCostUsd;
      break;
    case "run.failed":
      next.status = "failed";
      next.pending = [];
      next.paused = false;
      next.error = event.data.error;
      closeOpenSteps(next, "failed", "skipped");
      break;
    case "run.cancelled":
      next.status = "cancelled";
      next.pending = [];
      next.paused = false;
      closeOpenSteps(next, "cancelled", "cancelled");
      break;
  }
  return next;
}

export function totalUsage(run: RunView): Usage {
  const total = emptyUsage();
  for (const s of Object.values(run.steps)) {
    total.inputTokens += s.usage.inputTokens;
    total.outputTokens += s.usage.outputTokens;
    total.cacheReadTokens += s.usage.cacheReadTokens;
    total.cacheCreationTokens += s.usage.cacheCreationTokens;
  }
  return total;
}

// Most recently started step that is still running, for "follow active".
export function activeStep(run: RunView): string | undefined {
  const running = run.order.map((id) => run.steps[id]!).filter((s) => s.status === "running" || s.status === "waiting_approval");
  running.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return running[0]?.id;
}
