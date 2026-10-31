// Shared event protocol (docs/06-event-protocol.md).
// Server and web both import from here; the UI derives all state from these events.
import { z } from "zod";

export const AuthMode = z.enum(["api_key", "claude_cli_login", "observer", "bedrock", "vertex", "demo", "gemini", "meta", "openai_compat"]);
export type AuthMode = z.infer<typeof AuthMode>;

export const RunSource = z.enum(["claudestra", "observer"]);
export type RunSource = z.infer<typeof RunSource>;

export const ModelClass = z.enum(["cheap", "mid", "strong"]);
export type ModelClass = z.infer<typeof ModelClass>;

// Cost profiles (docs/11 §2.2): model per class, plan-size cap and default run budget.
export const Profile = z.enum(["eco", "balanced", "max"]);
export type Profile = z.infer<typeof Profile>;

// Approval modes (docs/04 "Approval modes").
export const ApprovalMode = z.enum(["manual", "smart", "auto"]);
export type ApprovalMode = z.infer<typeof ApprovalMode>;

export const RunMode = z.enum(["dynamic", "workflow"]);

// Language of the final answer and user-facing files; "auto" = the language of the request.
export const AnswerLanguage = z.enum(["auto", "az", "en", "ru", "tr"]);
export type AnswerLanguage = z.infer<typeof AnswerLanguage>;
export type RunMode = z.infer<typeof RunMode>;

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
  // For verifier steps (reviewer/tester/security): the step to send back for fixes when the verdict is CHANGES REQUESTED.
  loopBackTo: z.string().default(""),
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
  steps: z.array(PlanStep.extend({ dependsOn: z.array(z.string()), successCriteria: z.string(), loopBackTo: z.string() })),
});
export type Plan = z.infer<typeof Plan>;
export type PlannedStep = Plan["steps"][number];

// CEO decision after a step failed (docs/03 "review").
export const CeoReview = z.object({
  action: z.enum(["retry", "continue", "finish"]),
  revisedTask: z.string(),
  note: z.string(),
});
export type CeoReview = z.infer<typeof CeoReview>;

export const StepStatus = z.enum(["pending", "ready", "running", "waiting_approval", "succeeded", "failed", "skipped", "cancelled"]);
export type StepStatus = z.infer<typeof StepStatus>;

// Each event type with its payload.
export const EventData = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.started"),
    data: z.object({
      prompt: z.string(),
      source: RunSource,
      authMode: AuthMode,
      budgetUsd: z.number().nullable(),
      agents: z.array(AgentInfo).default([]),
      profile: Profile.default("balanced"),
      approvalMode: ApprovalMode.default("smart"),
      mode: RunMode.default("dynamic"),
      workflowId: z.string().optional(),
      origin: z.string().default("user"),
      createdBy: z.string().optional(),
      language: AnswerLanguage.default("auto"),
      // Set when the run continues a project (upgrade A3).
      project: z.object({ id: z.string(), name: z.string() }).optional(),
    }),
  }),
  z.object({ type: z.literal("run.paused"), data: z.object({ by: z.string() }) }),
  z.object({ type: z.literal("run.resumed"), data: z.object({ by: z.string() }) }),
  z.object({ type: z.literal("run.completed"), data: z.object({ answer: z.string(), totalCostUsd: z.number().nullable(), durationMs: z.number(), numTurns: z.number() }) }),
  z.object({ type: z.literal("run.failed"), data: z.object({ error: z.string() }) }),
  z.object({ type: z.literal("run.cancelled"), data: z.object({ by: z.string() }) }),

  z.object({ type: z.literal("plan.created"), data: z.object({ plan: Plan }) }),
  z.object({ type: z.literal("plan.approval_requested"), data: z.object({ approvalId: z.string() }) }),
  z.object({ type: z.literal("plan.approved"), data: z.object({ approvalId: z.string(), by: z.string() }) }),
  z.object({ type: z.literal("plan.rejected"), data: z.object({ approvalId: z.string(), by: z.string(), note: z.string().default("") }) }),
  z.object({ type: z.literal("ceo.review"), data: z.object({ stepId: z.string(), action: z.string(), note: z.string() }) }),

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
  // A step created during the run (coder⇄reviewer loop iterations).
  z.object({ type: z.literal("step.added"), data: z.object({ id: z.string(), agent: z.string(), task: z.string(), dependsOn: z.array(z.string()), loopOf: z.string(), iteration: z.number() }) }),
  z.object({ type: z.literal("step.retrying"), data: z.object({ attempt: z.number(), reason: z.string(), task: z.string() }) }),
  z.object({ type: z.literal("step.approval_requested"), data: z.object({ approvalId: z.string(), tool: z.string(), input: z.unknown(), reason: z.string() }) }),
  z.object({ type: z.literal("step.approved"), data: z.object({ approvalId: z.string(), by: z.enum(["user", "auto", "rule"]), scope: z.enum(["once", "run"]).default("once"), tool: z.string().default(""), reason: z.string().default("") }) }),
  z.object({ type: z.literal("step.rejected"), data: z.object({ approvalId: z.string(), by: z.string(), note: z.string().default("") }) }),
  z.object({ type: z.literal("skill.loaded"), data: z.object({ name: z.string() }) }),
  // Cross-run memory handed to the CEO / agents for this run (docs/04 "Context between runs").
  // A project run's changes were applied to (or taken back from) the project folder; may follow run.completed.
  z.object({ type: z.literal("project.applied"), data: z.object({ projectId: z.string(), applied: z.number(), skipped: z.number(), undone: z.boolean().default(false) }) }),
  z.object({ type: z.literal("memory.recalled"), data: z.object({ notes: z.number(), runs: z.array(z.object({ runId: z.string(), prompt: z.string() })) }) }),

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
  createdBy?: string | null;
  origin?: string | null;
};

export const Role = z.enum(["owner", "operator", "viewer"]);
export type Role = z.infer<typeof Role>;
export type SessionInfo = { authEnabled: boolean; user: { name: string; role: Role } | null };

export const CreateRunRequest = z.object({
  prompt: z.string().trim().max(20_000).default(""),
  profile: Profile.optional(),
  approvalMode: ApprovalMode.optional(),
  workflowId: z.string().optional(),
  params: z.record(z.string(), z.string()).default({}),
  language: AnswerLanguage.optional(),
  projectId: z.string().max(64).optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export type ProfileInfo = { models: Record<ModelClass, string>; planSizeCap: number; budgetUsd: number };

export type HealthResponse = {
  ok: true;
  authMode: AuthMode;
  canStartRuns: boolean;
  models: Record<ModelClass, string>;
  profiles: Record<Profile, ProfileInfo>;
  defaultProfile: Profile;
  defaultApprovalMode: ApprovalMode;
  agents: AgentInfo[];
  warning?: string;
  // What the Results bar can offer (docs/07 "Results").
  results?: { previewPort: number | null; previewUrl: string | null; openFolder: boolean; github: boolean };
};

export const ApprovalDecision = z.object({
  decision: z.enum(["approve", "approve_run", "reject"]),
  note: z.string().max(2000).default(""),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

// Max characters of a tool output kept in an event; full outputs become artifacts later (doc 6).
export const TOOL_OUTPUT_LIMIT = 4_000;
