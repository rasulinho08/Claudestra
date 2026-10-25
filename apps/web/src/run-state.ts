// Pure reducer: run view state is derived only from protocol events (docs/07 "Design principles").
import type { ClaudestraEvent, RunStatus, Usage } from "@claudestra/protocol";

export type TimelineItem =
  | { kind: "message"; id: string; role: "assistant" | "user" | "system"; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; tool: string; input: unknown; result?: { ok: boolean; output: string; truncated: boolean } }
  | { kind: "denied"; id: string; tool: string; reason: string }
  | { kind: "error"; id: string; text: string };

export type RunView = {
  lastSeq: number;
  prompt: string;
  status: RunStatus | "connecting";
  model?: string;
  apiKeySource?: string;
  budgetUsd: number | null;
  usage: Usage;
  costUsd: number | null;
  durationMs?: number;
  answer?: string;
  items: TimelineItem[];
};

export const emptyRun = (): RunView => ({
  lastSeq: 0,
  prompt: "",
  status: "connecting",
  budgetUsd: null,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  costUsd: null,
  items: [],
});

export function reduceRun(state: RunView, event: ClaudestraEvent): RunView {
  if (event.seq <= state.lastSeq) return state;
  const next: RunView = { ...state, lastSeq: event.seq };
  const items = state.items.slice();
  next.items = items;

  switch (event.type) {
    case "run.started":
      next.prompt = event.data.prompt;
      next.status = "running";
      next.budgetUsd = event.data.budgetUsd;
      break;
    case "step.started":
      next.model = event.data.model;
      next.apiKeySource = event.data.apiKeySource;
      break;
    case "step.message": {
      const { messageId, text, partial, role } = event.data;
      const idx = items.findIndex((i) => i.kind === "message" && i.id === messageId);
      const existing = idx >= 0 ? (items[idx] as Extract<TimelineItem, { kind: "message" }>) : undefined;
      if (!existing) {
        items.push({ kind: "message", id: messageId, role, text, streaming: partial });
      } else if (partial) {
        items[idx] = { ...existing, text: existing.text + text };
      } else {
        // Final text replaces streamed deltas; further final blocks of the same message are appended.
        items[idx] = { ...existing, text: existing.streaming ? text : `${existing.text}\n\n${text}`, streaming: false };
      }
      break;
    }
    case "step.thinking":
      items.push({ kind: "thinking", id: `th-${event.seq}`, text: event.data.text });
      break;
    case "tool.called":
      items.push({ kind: "tool", id: event.data.callId, tool: event.data.tool, input: event.data.input });
      break;
    case "tool.result": {
      const idx = items.findIndex((i) => i.kind === "tool" && i.id === event.data.callId);
      const { ok, output, truncated } = event.data;
      if (idx >= 0) items[idx] = { ...(items[idx] as Extract<TimelineItem, { kind: "tool" }>), result: { ok, output, truncated } };
      break;
    }
    case "tool.denied":
      items.push({ kind: "denied", id: `d-${event.seq}`, tool: event.data.tool, reason: event.data.reason });
      break;
    case "usage.updated": {
      const { costUsd, ...usage } = event.data;
      next.usage = usage;
      if (costUsd !== null) next.costUsd = costUsd;
      break;
    }
    case "step.failed":
      items.push({ kind: "error", id: `e-${event.seq}`, text: event.data.error });
      break;
    case "run.completed":
      next.status = "completed";
      next.answer = event.data.answer;
      next.durationMs = event.data.durationMs;
      if (event.data.totalCostUsd !== null) next.costUsd = event.data.totalCostUsd;
      break;
    case "run.failed":
      next.status = "failed";
      if (!items.some((i) => i.kind === "error" && i.text === event.data.error)) {
        items.push({ kind: "error", id: `e-${event.seq}`, text: event.data.error });
      }
      break;
    case "run.cancelled":
      next.status = "cancelled";
      break;
    case "step.succeeded":
      break;
  }
  return next;
}
