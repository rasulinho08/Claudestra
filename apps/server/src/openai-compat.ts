// AUTH_MODE=meta / openai_compat: runs an agent step on any OpenAI-compatible Chat Completions API (Meta Muse,
// OpenRouter, DeepSeek, Groq, a local Ollama or LM Studio...). Tools are Claudestra's own (local-tools.ts) and go
// through the same approval policy; skills and MCP apps are Claude Code features and are not available here.
import { randomUUID } from "node:crypto";
import type { EventData } from "@claudestra/protocol";
import type { SessionRunner } from "./session.ts";
import { HANDOFF_RULE } from "./session.ts";
import type { SessionOutcome } from "./sdk-mapper.ts";
import { truncate } from "./sdk-mapper.ts";
import { TOOL_DECLARATIONS, runLocalTool } from "./local-tools.ts";

const MAX_RETRIES = 3;
export const META_BASE_URL = "https://api.meta.ai/v1";

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; [k: string]: unknown }
  | { role: "tool"; tool_call_id: string; content: string };
type Completion = {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[]; reasoning_content?: string; [k: string]: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string } | string;
};

export type CompatEndpoint = { name: string; baseUrl: string; apiKey: string; priceIn: number; priceOut: number };

// Which endpoint the current AUTH_MODE talks to. Meta has defaults; openai_compat needs OPENAI_BASE_URL.
export function compatEndpoint(env: Record<string, string | undefined>): CompatEndpoint | { error: string } {
  if (env.AUTH_MODE === "meta") {
    const apiKey = env.META_API_KEY || env.MODEL_API_KEY || "";
    if (!apiKey) return { error: "AUTH_MODE=meta but META_API_KEY is not set in .env (create a key in Meta's developer console)" };
    return { name: "Meta", baseUrl: (env.META_BASE_URL || META_BASE_URL).replace(/\/+$/, ""), apiKey, priceIn: Number(env.META_PRICE_INPUT_PER_M) || 0, priceOut: Number(env.META_PRICE_OUTPUT_PER_M) || 0 };
  }
  if (!env.OPENAI_BASE_URL) return { error: "AUTH_MODE=openai_compat but OPENAI_BASE_URL is not set in .env (e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1)" };
  if (!env.OPENAI_MODEL && !env.OPENAI_MODEL_STRONG) return { error: "AUTH_MODE=openai_compat but OPENAI_MODEL is not set in .env" };
  return { name: "OpenAI-compatible", baseUrl: env.OPENAI_BASE_URL.replace(/\/+$/, ""), apiKey: env.OPENAI_API_KEY || "", priceIn: Number(env.OPENAI_PRICE_INPUT_PER_M) || 0, priceOut: Number(env.OPENAI_PRICE_OUTPUT_PER_M) || 0 };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

export function explainCompatError(name: string, status: number, message: string): string {
  if (status === 401 || status === 403) return `${message}\n\nFix: check the API key for ${name} in .env and restart.`;
  if (status === 404) return `${message}\n\nFix: the model id or base URL is wrong; check META_MODEL / OPENAI_MODEL and the base URL in .env.`;
  if (status === 402) return `${message}\n\nFix: the ${name} account has no credit left.`;
  if (status === 429) return `${message}\n\nThe ${name} rate limit was hit; wait a minute or use fewer agents (eco profile).`;
  return message;
}

const errorText = (body: Completion, status: number) => (typeof body.error === "string" ? body.error : body.error?.message) || `HTTP ${status}`;

export const compatSession: SessionRunner = async (req) => {
  const started = Date.now();
  const signal = req.controller.signal;
  const endpoint = compatEndpoint(req.env);
  const emit = (e: EventData) => !signal.aborted && req.emit(e);
  emit({ type: "step.started", data: { task: req.task, model: req.model, tools: [], apiKeySource: req.env.AUTH_MODE ?? "openai_compat" } });
  if ("error" in endpoint) {
    emit({ type: "step.failed", data: { error: endpoint.error } });
    return { ok: false, text: "", costUsd: 0, durationMs: 0, numTurns: 0, error: endpoint.error };
  }

  const isCeo = req.agent.info.id === "ceo";
  const decls = isCeo ? [] : req.agent.tools.filter((t) => TOOL_DECLARATIONS[t]).map((t) => TOOL_DECLARATIONS[t]!);
  const tools = decls.map((d) => ({ type: "function" as const, function: { name: d.name, description: d.description, parameters: d.parameters } }));
  let system = isCeo ? req.agent.systemPrompt : req.agent.systemPrompt + HANDOFF_RULE;
  if (tools.length > 0) system += "\n\nWork only with relative paths inside the current workspace folder. Use the tools to do the work, then reply with your report.";
  let userText = req.prompt;
  if (req.outputSchema) userText += `\n\nReply with only a JSON object (no markdown) that matches this JSON schema:\n${JSON.stringify(req.outputSchema)}`;

  const messages: Message[] = [
    { role: "system", content: system },
    { role: "user", content: userText },
  ];
  const total = { in: 0, out: 0, cached: 0 };
  const cost = () => Math.round(((total.in * endpoint.priceIn + total.out * endpoint.priceOut) / 1_000_000) * 1e6) / 1e6;
  const usage = (final: boolean) =>
    emit({ type: "usage.updated", data: { inputTokens: total.in, outputTokens: total.out, cacheReadTokens: total.cached, cacheCreationTokens: 0, costUsd: final ? cost() : null } });
  let turns = 0;
  let lastText = "";
  // Some providers reject response_format; drop it after the first refusal.
  let useJsonSchema = Boolean(req.outputSchema);
  const fail = (error: string): SessionOutcome => {
    emit({ type: "step.failed", data: { error } });
    return { ok: false, text: lastText, costUsd: cost(), durationMs: Date.now() - started, numTurns: turns, error };
  };
  const cancelled = (): SessionOutcome => ({ ok: false, text: "", costUsd: cost(), durationMs: Date.now() - started, numTurns: turns, error: "cancelled" });

  while (turns < req.agent.limits.maxTurns) {
    if (signal.aborted) return cancelled();
    if (endpoint.priceIn + endpoint.priceOut > 0 && cost() > req.budgetUsd) return fail(`Step budget of $${req.budgetUsd.toFixed(2)} reached`);
    turns++;

    let data: Completion | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const body: Record<string, unknown> = { model: req.model, messages };
      if (tools.length > 0) body.tools = tools;
      if (useJsonSchema && req.outputSchema) body.response_format = { type: "json_schema", json_schema: { name: "decision", schema: req.outputSchema } };
      let res: Response;
      try {
        res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (signal.aborted) return cancelled();
        return fail(`Could not reach ${endpoint.name} at ${endpoint.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
      const json = (await res.json().catch(() => ({}))) as Completion;
      if (res.ok) {
        data = json;
        break;
      }
      const msg = errorText(json, res.status);
      if (res.status === 400 && useJsonSchema && /response_format|json_schema/i.test(msg)) {
        useJsonSchema = false; // the orchestrator still finds the JSON in plain text
        attempt--;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 2000 * 2 ** attempt;
        emit({ type: "step.message", data: { messageId: randomUUID(), role: "system", partial: false, text: `${endpoint.name} is busy or rate-limited (${res.status}); retrying in ${Math.round(wait / 1000)} s…` } });
        await sleep(wait, signal);
        continue;
      }
      return fail(explainCompatError(endpoint.name, res.status, msg));
    }
    if (!data) return fail(`No response from ${endpoint.name}`);

    total.in += data.usage?.prompt_tokens ?? 0;
    total.out += data.usage?.completion_tokens ?? 0;
    total.cached += data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    usage(false);

    const msg = data.choices?.[0]?.message;
    if (!msg) return fail(`${endpoint.name} returned no message (${data.choices?.[0]?.finish_reason ?? "unknown reason"})`);
    // The assistant turn goes back verbatim (keeps provider-specific fields such as reasoning).
    messages.push({ ...msg, role: "assistant", content: msg.content ?? null });

    const messageId = randomUUID();
    if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) emit({ type: "step.thinking", data: { messageId, text: msg.reasoning_content } });
    const text = typeof msg.content === "string" ? msg.content : "";
    if (text.trim()) {
      lastText = text;
      for (const chunk of text.match(/[\s\S]{1,80}/g) ?? []) emit({ type: "step.message", data: { messageId, text: chunk, partial: true } });
      emit({ type: "step.message", data: { messageId, text, partial: false } });
    }

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) break;
    for (const call of calls) {
      const callId = call.id || `c-${randomUUID()}`;
      let input: Record<string, unknown> = {};
      let ok = false;
      let output = "";
      try {
        input = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
      } catch {
        output = "The tool arguments were not valid JSON; send them again as a JSON object.";
      }
      emit({ type: "tool.called", data: { callId, tool: call.function.name, input } });
      if (!output) {
        const decision = await req.authorize(call.function.name, input);
        if (!decision.allow) output = decision.reason;
        else {
          try {
            ({ ok, output } = await runLocalTool(call.function.name, input, req.workspace, signal));
          } catch (err) {
            output = err instanceof Error ? err.message : String(err);
          }
        }
      }
      const shown = truncate(output);
      emit({ type: "tool.result", data: { callId, ok, output: shown.output, truncated: shown.truncated } });
      messages.push({ role: "tool", tool_call_id: callId, content: ok ? output : `ERROR: ${output}` });
    }
  }

  usage(true);
  if (signal.aborted) return cancelled();
  if (!lastText.trim()) return fail(`${endpoint.name} stopped after ${turns} turn(s) without a final reply (turn limit ${req.agent.limits.maxTurns})`);
  let structured: unknown;
  if (req.outputSchema) {
    try {
      structured = JSON.parse(lastText.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      structured = undefined; // the orchestrator falls back to extracting JSON from the text
    }
  }
  emit({ type: "step.succeeded", data: { summary: lastText.slice(0, 300), costUsd: cost(), durationMs: Date.now() - started } });
  return { ok: true, text: lastText, structured, costUsd: cost(), durationMs: Date.now() - started, numTurns: turns };
};
