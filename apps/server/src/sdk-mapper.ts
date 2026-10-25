// Translates Agent SDK messages into Claudestra events (docs/06 "Mapping SDK messages → events").
// Stateful: groups streamed deltas by message id and dedupes per-message usage.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { emptyUsage, TOOL_OUTPUT_LIMIT, type EventData, type Usage } from "@claudestra/protocol";

type Block = { type: string; [key: string]: unknown };

export function truncate(text: string, limit = TOOL_OUTPUT_LIMIT): { output: string; truncated: boolean } {
  if (text.length <= limit) return { output: text, truncated: false };
  return { output: `${text.slice(0, limit)}\n… [${text.length - limit} more characters]`, truncated: true };
}

function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: Block) => (part.type === "text" && typeof part.text === "string" ? part.text : `[${part.type}]`))
      .join("\n");
  }
  return content === undefined ? "" : JSON.stringify(content);
}

function toUsage(raw: Record<string, unknown> | undefined | null): Usage {
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    inputTokens: n(raw?.input_tokens),
    outputTokens: n(raw?.output_tokens),
    cacheReadTokens: n(raw?.cache_read_input_tokens),
    cacheCreationTokens: n(raw?.cache_creation_input_tokens),
  };
}

// How the session ended, read by the orchestrator after the stream finishes.
export type SessionOutcome = {
  ok: boolean;
  text: string;
  structured?: unknown;
  costUsd: number | null;
  durationMs: number;
  numTurns: number;
  error?: string;
};

export class SdkEventMapper {
  private streamingMessageId: string | null = null;
  private usageByMessage = new Map<string, Usage>();
  private answer = "";
  outcome: SessionOutcome | null = null;

  constructor(private task: string) {}

  map(msg: SDKMessage): EventData[] {
    // Phase 0 runs one agent without subagents; nested events are attributed in Phase 1+.
    if ("parent_tool_use_id" in msg && msg.parent_tool_use_id) return [];

    switch (msg.type) {
      case "system":
        if (msg.subtype !== "init") return [];
        return [
          {
            type: "step.started",
            data: { task: this.task, model: msg.model, tools: msg.tools, apiKeySource: msg.apiKeySource },
          },
        ];

      case "stream_event": {
        const ev = msg.event as { type: string; message?: { id: string }; delta?: { type: string; text?: string } };
        if (ev.type === "message_start" && ev.message) this.streamingMessageId = ev.message.id;
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text && this.streamingMessageId) {
          return [{ type: "step.message", data: { messageId: this.streamingMessageId, text: ev.delta.text, partial: true, role: "assistant" } }];
        }
        return [];
      }

      case "assistant": {
        const message = msg.message as unknown as { id: string; content: Block[]; usage?: Record<string, unknown> };
        const out: EventData[] = [];
        for (const block of message.content) {
          if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
            this.answer = block.text;
            out.push({ type: "step.message", data: { messageId: message.id, text: block.text, partial: false, role: "assistant" } });
          } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0) {
            out.push({ type: "step.thinking", data: { messageId: message.id, text: block.thinking } });
          } else if (block.type === "tool_use" || block.type === "server_tool_use" || block.type === "mcp_tool_use") {
            out.push({ type: "tool.called", data: { callId: String(block.id), tool: String(block.name), input: block.input } });
          }
        }
        if (message.usage) {
          this.usageByMessage.set(message.id, toUsage(message.usage));
          out.push({ type: "usage.updated", data: { ...this.totalUsage(), costUsd: null } });
        }
        return out;
      }

      case "user": {
        const content = (msg.message as { content: unknown }).content;
        if (!Array.isArray(content)) return [];
        return content
          .filter((block: Block) => block.type === "tool_result")
          .map((block: Block) => {
            const { output, truncated } = truncate(stringifyToolContent(block.content));
            return {
              type: "tool.result" as const,
              data: { callId: String(block.tool_use_id), ok: block.is_error !== true, output, truncated },
            };
          });
      }

      case "result": {
        const usage = { ...toUsage(msg.usage as unknown as Record<string, unknown>), costUsd: msg.total_cost_usd };
        if (msg.subtype === "success" && !msg.is_error) {
          const text = msg.result || this.answer;
          this.outcome = { ok: true, text, structured: msg.structured_output, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, numTurns: msg.num_turns };
          return [
            { type: "usage.updated", data: usage },
            { type: "step.succeeded", data: { summary: text.slice(0, 300), costUsd: msg.total_cost_usd, durationMs: msg.duration_ms } },
          ];
        }
        const error =
          "errors" in msg && msg.errors.length > 0 ? msg.errors.join("; ") : `${msg.subtype}${"result" in msg && msg.result ? `: ${msg.result}` : ""}`;
        this.outcome = { ok: false, text: this.answer, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, numTurns: msg.num_turns, error };
        return [
          { type: "usage.updated", data: usage },
          { type: "step.failed", data: { error } },
        ];
      }

      default:
        return [];
    }
  }

  private totalUsage(): Usage {
    const total = emptyUsage();
    for (const u of this.usageByMessage.values()) {
      total.inputTokens += u.inputTokens;
      total.outputTokens += u.outputTokens;
      total.cacheReadTokens += u.cacheReadTokens;
      total.cacheCreationTokens += u.cacheCreationTokens;
    }
    return total;
  }
}
