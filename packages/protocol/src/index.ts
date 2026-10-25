// Shared event protocol (docs/06-event-protocol.md).
// Server and web both import from here; the UI derives all state from these events.
import { z } from "zod";

export const AuthMode = z.enum(["api_key", "claude_cli_login", "observer", "bedrock", "vertex"]);
export type AuthMode = z.infer<typeof AuthMode>;

export const RunSource = z.enum(["claudestra", "observer"]);
export type RunSource = z.infer<typeof RunSource>;

const Usage = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
});
export type Usage = z.infer<typeof Usage>;

// Each event type with its payload. Phase 0 covers a single step per run;
// plan/ceo/approval events arrive in later phases (doc 10).
export const EventData = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), data: z.object({ prompt: z.string(), source: RunSource, authMode: AuthMode, budgetUsd: z.number().nullable() }) }),
  z.object({ type: z.literal("run.completed"), data: z.object({ answer: z.string(), totalCostUsd: z.number().nullable(), durationMs: z.number(), numTurns: z.number() }) }),
  z.object({ type: z.literal("run.failed"), data: z.object({ error: z.string() }) }),
  z.object({ type: z.literal("run.cancelled"), data: z.object({ by: z.string() }) }),
  z.object({ type: z.literal("step.started"), data: z.object({ task: z.string(), model: z.string(), tools: z.array(z.string()), apiKeySource: z.string().optional() }) }),
  // messageId groups deltas (partial: true) with the final full text (partial: false).
  z.object({ type: z.literal("step.message"), data: z.object({ messageId: z.string(), text: z.string(), partial: z.boolean(), role: z.enum(["assistant", "user", "system"]).default("assistant") }) }),
  z.object({ type: z.literal("step.thinking"), data: z.object({ messageId: z.string(), text: z.string() }) }),
  z.object({ type: z.literal("step.succeeded"), data: z.object({ summary: z.string(), costUsd: z.number().nullable(), durationMs: z.number() }) }),
  z.object({ type: z.literal("step.failed"), data: z.object({ error: z.string() }) }),
  z.object({ type: z.literal("tool.called"), data: z.object({ callId: z.string(), tool: z.string(), input: z.unknown() }) }),
  z.object({ type: z.literal("tool.result"), data: z.object({ callId: z.string(), ok: z.boolean(), output: z.string(), truncated: z.boolean() }) }),
  z.object({ type: z.literal("tool.denied"), data: z.object({ tool: z.string(), reason: z.string() }) }),
  z.object({ type: z.literal("usage.updated"), data: Usage.extend({ costUsd: z.number().nullable() }) }),
]);
export type EventData = z.infer<typeof EventData>;
export type EventType = EventData["type"];

export type ClaudestraEvent = EventData & {
  seq: number;
  runId: string;
  ts: string;
  stepId?: string;
  agentId?: string;
};

export type DataOf<T extends EventType> = Extract<EventData, { type: T }>["data"];

export const RunStatus = z.enum(["running", "completed", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export type RunSummary = {
  id: string;
  prompt: string;
  source: RunSource;
  status: RunStatus;
  startedAt: string;
  costUsd: number | null;
};

export const CreateRunRequest = z.object({
  prompt: z.string().trim().min(1).max(20_000),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export type HealthResponse = {
  ok: true;
  authMode: AuthMode;
  canStartRuns: boolean;
  model: string;
  warning?: string;
};

// Max characters of a tool output kept in an event; the rest is dropped in Phase 0
// (stored as an artifact from Phase 1, doc 6 "Persistence & size").
export const TOOL_OUTPUT_LIMIT = 4_000;
