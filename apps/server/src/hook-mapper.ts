// Observer mode (docs/11 §1.1 C): Claude Code hook payloads → Claudestra events.
// Each Claude Code session becomes one run; payload fields are read defensively because
// hook payloads differ between Claude Code versions.
import { randomUUID } from "node:crypto";
import type { EventData } from "@claudestra/protocol";
import { truncate } from "./sdk-mapper.ts";

export type HookPayload = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export class HookEventMapper {
  // Pairs PreToolUse with PostToolUse when the payload carries no tool_use_id.
  private pending = new Map<string, string[]>();

  map(event: string, payload: HookPayload): EventData[] {
    switch (event) {
      case "SessionStart":
        return [{ type: "step.message", data: { messageId: randomUUID(), text: `Session started (${str(payload.source) ?? "startup"})`, partial: false, role: "system" } }];

      case "UserPromptSubmit": {
        const prompt = str(payload.prompt);
        return prompt ? [{ type: "step.message", data: { messageId: randomUUID(), text: prompt, partial: false, role: "user" } }] : [];
      }

      case "PreToolUse": {
        const tool = str(payload.tool_name) ?? "unknown";
        const callId = str(payload.tool_use_id) ?? randomUUID();
        if (!str(payload.tool_use_id)) this.pending.set(tool, [...(this.pending.get(tool) ?? []), callId]);
        return [{ type: "tool.called", data: { callId, tool, input: payload.tool_input ?? {} } }];
      }

      case "PostToolUse":
      case "PostToolUseFailure": {
        const tool = str(payload.tool_name) ?? "unknown";
        const callId = str(payload.tool_use_id) ?? this.pending.get(tool)?.shift() ?? randomUUID();
        const raw = payload.tool_response ?? payload.error ?? "";
        const { output, truncated } = truncate(typeof raw === "string" ? raw : JSON.stringify(raw));
        return [{ type: "tool.result", data: { callId, ok: event === "PostToolUse", output, truncated } }];
      }

      case "SubagentStop":
        return [{ type: "step.message", data: { messageId: randomUUID(), text: `Subagent finished${str(payload.agent_type) ? `: ${payload.agent_type}` : ""}`, partial: false, role: "system" } }];

      case "Stop": {
        const text = str(payload.last_assistant_message);
        return text ? [{ type: "step.message", data: { messageId: randomUUID(), text, partial: false, role: "assistant" } }] : [];
      }

      case "SessionEnd":
        return [{ type: "run.completed", data: { answer: "", totalCostUsd: null, durationMs: 0, numTurns: 0 } }];

      default:
        return [];
    }
  }
}
