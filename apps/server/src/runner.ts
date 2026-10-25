// Runs one prompt as one Agent SDK session and streams its events into the store.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "./config.ts";
import type { RunStore } from "./store.ts";
import { resolveSdkAuth } from "./auth.ts";
import { SdkEventMapper } from "./sdk-mapper.ts";
import { checkToolUse, PHASE0_TOOLS } from "./sandbox.ts";

const STEP_ID = "s1";
const AGENT_ID = "assistant";

export class Runner {
  private controllers = new Map<string, AbortController>();

  constructor(private config: Config, private store: RunStore) {}

  async start(runId: string, prompt: string): Promise<void> {
    const auth = resolveSdkAuth(this.config.authMode, process.env);
    if (!auth.ok) throw new Error(auth.reason);

    const workspace = path.join(this.config.workspacesDir, runId);
    await mkdir(workspace, { recursive: true });

    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const emit = (data: Parameters<RunStore["append"]>[1]) => {
      // After cancel/failure nothing else is recorded for this run.
      if (this.store.status(runId) !== "running") return;
      this.store.append(runId, data, data.type.startsWith("run.") ? {} : { stepId: STEP_ID, agentId: AGENT_ID });
    };

    const mapper = new SdkEventMapper(prompt);
    let sawResult = false;
    try {
      const stream = query({
        prompt,
        options: {
          cwd: workspace,
          model: this.config.model,
          env: auth.env,
          abortController: controller,
          includePartialMessages: true,
          maxTurns: this.config.maxTurns,
          maxBudgetUsd: this.config.runBudgetUsd,
          tools: PHASE0_TOOLS,
          // Isolated from the owner's own Claude Code settings, hooks and plugins.
          settingSources: [],
          permissionMode: "default",
          canUseTool: async (tool, input) => {
            const decision = checkToolUse(workspace, tool, input);
            if (decision.allow) return { behavior: "allow", updatedInput: input };
            emit({ type: "tool.denied", data: { tool, reason: decision.reason } });
            return { behavior: "deny", message: decision.reason };
          },
          pathToClaudeCodeExecutable: this.config.claudeCodePath,
        },
      });
      for await (const msg of stream) {
        for (const event of mapper.map(msg)) {
          if (event.type === "run.completed" || event.type === "run.failed") sawResult = true;
          emit(event);
        }
      }
      if (!sawResult && !controller.signal.aborted) {
        emit({ type: "run.failed", data: { error: "Agent session ended without a result" } });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err.message : String(err);
      emit({ type: "step.failed", data: { error } });
      emit({ type: "run.failed", data: { error } });
    } finally {
      this.controllers.delete(runId);
    }
  }

  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort();
    this.store.append(runId, { type: "run.cancelled", data: { by: "user" } });
    return true;
  }
}
