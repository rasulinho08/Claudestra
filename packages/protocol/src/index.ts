// Shared event protocol (docs/06-event-protocol.md).
// Server and web both import from here; the UI derives all state from these events.
import { z } from "zod";

export const AuthMode = z.enum(["api_key", "claude_cli_login", "observer", "bedrock", "vertex"]);
export type AuthMode = z.infer<typeof AuthMode>;

export const RunSource = z.enum(["claudestra", "observer"]);
export type RunSource = z.infer<typeof RunSource>;

export const ModelClass = z.enum(["cheap", "mid", "strong"]);
export type ModelClass = z.infer<typeof ModelClass>;

const Usage = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
});
export type Usage = z.infer<typeof Usage>;

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });

// Public view of an agent definition (agents/*.md), shipped with run.started so the UI can draw nodes.
export const AgentInfo = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  icon: z.string(),
  modelClass: ModelClass,
});
export type AgentInfo = z.infer<typeof AgentInfo>;

// Reserved step ids for the CEO's own nodes.
export const CEO_PLAN_STEP = "ceo";
export const CEO_FINAL_STEP = "final";

// What the CEO returns from its planning call (docs/03 "CEO behaviour").
export const PlanStep = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,24}$/, "lowercase id like s1"),
  agent: z.string(),
  task: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  successCriteria: z.string().default(""),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const Route = z.enum(["direct", "single_agent", "team"]);
export type Route = z.infer<typeof Route>;

export const CeoDecision = z.object({
  route: Route,
  summary: z.string(),
  directAnswer: z.string().default(""),
  steps: z.array(PlanStep).default([]),
});
export type CeoDecision = z.infer<typeof CeoDecision>;

export const Plan = z.object({
  route: Route,
  summary: z.string(),
  steps: z.array(PlanStep.extend({ dependsOn: z.array(z.string()), successCriteria: z.string() })),
});
export type Plan = z.infer<typeof Plan>;

export const StepStatus = z.enum(["pending", "ready", "running", "succeeded", "failed", "skipped", "cancelled"]);
export type StepStatus = z.infer<typeof StepStatus>;

// Each event type with its payload.
export const EventData = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), data: z.object({ prompt: z.string(), source: RunSource, authMode: AuthMode, budgetUsd: z.number().nullable(), agents: z.array(AgentInfo).default([]) }) }),
  z.object({ type: z.literal("run.completed"), data: z.object({ answer: z.string(), totalCostUsd: z.number().nullable(), durationMs: z.number(), numTurns: z.number() }) }),
  z.object({ type: z.literal("run.failed"), data: z.object({ error: z.string() }) }),
  z.object({ type: z.literal("run.cancelled"), data: z.object({ by: z.string() }) }),

  z.object({ type: z.literal("plan.created"), data: z.object({ plan: Plan }) }),

  z.object({ type: z.literal("step.ready"), data: z.object({ task: z.string() }) }),
  z.object({ type: z.literal("step.started"), data: z.object({ task: z.string(), model: z.string(), tools: z.array(z.string()), apiKeySource: z.string().optional() }) }),
  // messageId groups deltas (partial: true) with the final full text (partial: false).
  z.object({ type: z.literal("step.message"), data: z.object({ messageId: z.string(), text: z.string(), partial: z.boolean(), role: z.enum(["assistant", "user", "system"]).default("assistant") }) }),
  z.object({ type: z.literal("step.thinking"), data: z.object({ messageId: z.string(), text: z.string() }) }),
  z.object({ type: z.literal("step.handoff"), data: z.object({ from: z.string(), to: z.string(), summary: z.string() }) }),
  z.object({ type: z.literal("step.succeeded"), data: z.object({ summary: z.string(), costUsd: z.number().nullable(), durationMs: z.number() }) }),
  z.object({ type: z.literal("step.failed"), data: z.object({ error: z.string() }) }),
  z.object({ type: z.literal("step.skipped"), data: z.object({ reason: z.string() }) }),
  z.object({ type: z.literal("step.cancelled"), data: z.object({}) }),

  z.object({ type: z.literal("tool.called"), data: z.object({ callId: z.string(), tool: z.string(), input: z.unknown() }) }),
  z.object({ type: z.literal("tool.result"), data: z.object({ callId: z.string(), ok: z.boolean(), output: z.string(), truncated: z.boolean() }) }),
  z.object({ type: z.literal("tool.denied"), data: z.object({ tool: z.string(), reason: z.string() }) }),

  z.object({ type: z.literal("artifact.created"), data: z.object({ id: z.string(), title: z.string(), path: z.string(), bytes: z.number() }) }),

  // Step-scoped usage. costUsd is the step's cost once known; runCostUsd is the run total so far.
  z.object({ type: z.literal("usage.updated"), data: Usage.extend({ costUsd: z.number().nullable(), runCostUsd: z.number().nullable().default(null) }) }),
  z.object({ type: z.literal("budget.warning"), data: z.object({ spentUsd: z.number(), limitUsd: z.number() }) }),
  z.object({ type: z.literal("budget.exceeded"), data: z.object({ spentUsd: z.number(), limitUsd: z.number() }) }),
]);
export type EventData = z.input<typeof EventData>;
export type EventType = EventData["type"];

export type ClaudestraEvent = z.infer<typeof EventData> & {
  seq: number;
  runId: string;
  ts: string;
  stepId?: string;
  agentId?: string;
};

export type DataOf<T extends EventType> = Extract<z.infer<typeof EventData>, { type: T }>["data"];

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
  models: Record<ModelClass, string>;
  agents: AgentInfo[];
  warning?: string;
};

// Max characters of a tool output kept in an event; full outputs become artifacts later (doc 6).
export const TOOL_OUTPUT_LIMIT = 4_000;
