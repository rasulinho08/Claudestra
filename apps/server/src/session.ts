// Runs one agent as one Agent SDK session (docs/02 option B) and streams its events.
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { EventData } from "@claudestra/protocol";
import type { AgentDefinition } from "./agents.ts";
import { SdkEventMapper, type SessionOutcome } from "./sdk-mapper.ts";
import { checkToolUse } from "./sandbox.ts";

export type SessionRequest = {
  agent: AgentDefinition;
  prompt: string;
  task: string;
  workspace: string;
  model: string;
  budgetUsd: number;
  env: Record<string, string | undefined>;
  controller: AbortController;
  emit: (event: EventData) => void;
  outputSchema?: Record<string, unknown>;
  claudeCodePath?: string;
};

// Appended to every specialist's system prompt so downstream agents get a short handoff (docs/03 "Handoffs").
export const HANDOFF_RULE = `

End your reply with a section titled "## Summary" of at most 120 words: what you did, key results, and the paths of any files you created or changed. The next agent sees only this summary plus the files in the workspace, so make it self-contained.`;

export type SessionRunner = (req: SessionRequest) => Promise<SessionOutcome>;

export const runAgentSession: SessionRunner = async (req) => {
  const mapper = new SdkEventMapper(req.task);
  const options: Options = {
    cwd: req.workspace,
    model: req.model,
    env: req.env,
    abortController: req.controller,
    includePartialMessages: true,
    maxTurns: req.agent.limits.maxTurns,
    maxBudgetUsd: req.budgetUsd,
    tools: req.agent.tools,
    // A custom prompt instead of the full Claude Code preset keeps every call small (docs/11 §2.4).
    systemPrompt: req.agent.info.id === "ceo" ? req.agent.systemPrompt : req.agent.systemPrompt + HANDOFF_RULE,
    // Isolated from the owner's own Claude Code settings, hooks and plugins.
    settingSources: [],
    permissionMode: "default",
    canUseTool: async (tool, input) => {
      const allowed = req.agent.tools.includes(tool) ? checkToolUse(req.workspace, tool, input) : { allow: false as const, reason: `${tool} is not enabled for ${req.agent.info.name}` };
      if (allowed.allow) return { behavior: "allow", updatedInput: input };
      req.emit({ type: "tool.denied", data: { tool, reason: allowed.reason } });
      return { behavior: "deny", message: allowed.reason };
    },
    pathToClaudeCodeExecutable: req.claudeCodePath,
  };
  if (req.outputSchema) options.outputFormat = { type: "json_schema", schema: req.outputSchema };

  try {
    for await (const msg of query({ prompt: req.prompt, options })) {
      for (const event of mapper.map(msg)) req.emit(event);
    }
  } catch (err) {
    if (req.controller.signal.aborted) return { ok: false, text: "", costUsd: null, durationMs: 0, numTurns: 0, error: "cancelled" };
    const error = err instanceof Error ? err.message : String(err);
    req.emit({ type: "step.failed", data: { error } });
    return { ok: false, text: "", costUsd: mapper.outcome?.costUsd ?? null, durationMs: 0, numTurns: 0, error };
  }
  if (mapper.outcome) return mapper.outcome;
  const error = req.controller.signal.aborted ? "cancelled" : "Agent session ended without a result";
  if (!req.controller.signal.aborted) req.emit({ type: "step.failed", data: { error } });
  return { ok: false, text: "", costUsd: null, durationMs: 0, numTurns: 0, error };
};
