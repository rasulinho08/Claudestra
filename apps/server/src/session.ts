// Runs one agent as one Agent SDK session (docs/02 option B) and streams its events.
import { query, type McpServerConfig, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { EventData } from "@claudestra/protocol";
import type { AgentDefinition } from "./agents.ts";
import { SdkEventMapper, explainError, type SessionOutcome } from "./sdk-mapper.ts";

export type Authorization = { allow: true } | { allow: false; reason: string };

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
  // Decides every tool call the SDK asks about (sandbox, allow-lists, approvals). May wait for the user.
  authorize: (tool: string, input: Record<string, unknown>) => Promise<Authorization>;
  outputSchema?: Record<string, unknown>;
  skills?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  osSandbox?: boolean;
  claudeCodePath?: string;
};

// Appended to every specialist's system prompt so downstream agents get a short handoff (docs/03 "Handoffs").
export const HANDOFF_RULE = `

End your reply with a section titled "## Summary" of at most 120 words: what you did, key results, and the paths of any files you created or changed. The next agent sees only this summary plus the files in the workspace, so make it self-contained.`;

export type SessionRunner = (req: SessionRequest) => Promise<SessionOutcome>;

export const runAgentSession: SessionRunner = async (req) => {
  const mapper = new SdkEventMapper(req.task);
  const hasSkills = (req.skills?.length ?? 0) > 0;
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
    // Isolated from the owner's settings; "project" only to discover skills copied into the workspace.
    settingSources: hasSkills ? ["project"] : [],
    permissionMode: "default",
    canUseTool: async (tool, input) => {
      const decision = await req.authorize(tool, input);
      if (decision.allow) return { behavior: "allow", updatedInput: input };
      return { behavior: "deny", message: decision.reason };
    },
    pathToClaudeCodeExecutable: req.claudeCodePath,
  };
  if (hasSkills) options.skills = req.skills;
  if (req.mcpServers && Object.keys(req.mcpServers).length > 0) options.mcpServers = req.mcpServers;
  if (req.osSandbox && req.agent.tools.includes("Bash")) {
    options.sandbox = { enabled: true, failIfUnavailable: false, autoAllowBashIfSandboxed: false };
  }
  if (req.outputSchema) options.outputFormat = { type: "json_schema", schema: req.outputSchema };

  try {
    for await (const msg of query({ prompt: req.prompt, options })) {
      for (const event of mapper.map(msg)) req.emit(event);
    }
  } catch (err) {
    if (req.controller.signal.aborted) return { ok: false, text: "", costUsd: null, durationMs: 0, numTurns: 0, error: "cancelled" };
    const error = explainError(err instanceof Error ? err.message : String(err));
    req.emit({ type: "step.failed", data: { error } });
    return { ok: false, text: "", costUsd: mapper.outcome?.costUsd ?? null, durationMs: 0, numTurns: 0, error };
  }
  if (mapper.outcome) return mapper.outcome;
  const error = req.controller.signal.aborted ? "cancelled" : "Agent session ended without a result";
  if (!req.controller.signal.aborted) req.emit({ type: "step.failed", data: { error } });
  return { ok: false, text: "", costUsd: null, durationMs: 0, numTurns: 0, error };
};
