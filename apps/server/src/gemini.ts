// AUTH_MODE=gemini: runs an agent step on Google's Gemini API (generateContent + function calling) instead of the
// Claude Agent SDK. Tools are Claudestra's own (local-tools.ts) and go through the same approval policy.
// Skills work through the Skill tool (local-tools.ts); MCP apps need Claude.
import { randomUUID } from "node:crypto";
import type { EventData } from "@claudestra/protocol";
import type { SessionRunner } from "./session.ts";
import { HANDOFF_RULE } from "./session.ts";
import type { SessionOutcome } from "./sdk-mapper.ts";
import { truncate } from "./sdk-mapper.ts";
import { declarationsFor, runLocalTool, skillCatalog } from "./local-tools.ts";
import { gateFor, maxWaitMs, retryDecision } from "./quota.ts";

const API = process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";

type Part = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { id?: string; name: string; args?: Record<string, unknown> }; functionResponse?: unknown };
type Content = { role: "user" | "model"; parts: Part[] };
type Usage = { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
type Response = { candidates?: { content?: Content; finishReason?: string }[]; usageMetadata?: Usage; promptFeedback?: { blockReason?: string }; error?: { message?: string; code?: number; details?: unknown[] } };

// Optional prices (USD per 1M tokens) so budgets and the Costs page mean something on a paid key; free tier = 0.
const PRICE_IN = Number(process.env.GEMINI_PRICE_INPUT_PER_M) || 0;
const PRICE_OUT = Number(process.env.GEMINI_PRICE_OUTPUT_PER_M) || 0;

// Gemini puts the wait in the error details (RetryInfo.retryDelay "37s"); per-day quotas name "PerDay" in QuotaFailure.
export function geminiRetryInfo(body: Response): { retryAfterMs: number | null; daily: boolean } {
  const details = body.error?.details ?? [];
  const info = details.find((d) => typeof d === "object" && d && "retryDelay" in d) as { retryDelay?: string } | undefined;
  const s = Number.parseFloat(info?.retryDelay ?? "");
  return { retryAfterMs: Number.isFinite(s) ? s * 1000 + 500 : null, daily: /PerDay/i.test(JSON.stringify(details)) };
}

export function explainGeminiError(status: number, message: string): string {
  if (status === 400 && /api key/i.test(message)) return `${message}\n\nFix: check GEMINI_API_KEY in .env (aistudio.google.com → Get API key) and restart.`;
  if (status === 403) return `${message}\n\nFix: the key has no access to this model; set GEMINI_MODEL_STRONG / GEMINI_MODEL_MID / GEMINI_MODEL_CHEAP in .env to models your key can use.`;
  if (status === 404) return `${message}\n\nFix: this model id does not exist (any more); set GEMINI_MODEL_* in .env (see ai.google.dev/gemini-api/docs/models).`;
  if (status === 429) return `${message}\n\nThe free tier allows only a few requests per minute: use the eco profile, fewer agents, or wait a minute.`;
  return message;
}

export const geminiSession: SessionRunner = async (req) => {
  const started = Date.now();
  const signal = req.controller.signal;
  const key = req.env.GEMINI_API_KEY ?? req.env.GOOGLE_API_KEY ?? "";
  const emit = (e: EventData) => !signal.aborted && req.emit(e);
  const isCeo = req.agent.info.id === "ceo";
  const skills = isCeo ? [] : (req.skills ?? []);
  const tools = isCeo ? [] : declarationsFor(req.agent.tools, skills);
  let system = isCeo ? req.agent.systemPrompt : req.agent.systemPrompt + HANDOFF_RULE + skillCatalog(req.workspace, skills);
  if (tools.length > 0) system += "\n\nWork only with relative paths inside the current workspace folder. Use the tools to do the work, then reply with your report.";
  let userText = req.prompt;
  if (req.outputSchema) userText += `\n\nReply with only a JSON object (no markdown) that matches this JSON schema:\n${JSON.stringify(req.outputSchema)}`;

  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];
  const gate = gateFor("gemini", req.env);
  const waitLimit = maxWaitMs(req.env);
  let waited = 0;
  const total = { in: 0, out: 0, cached: 0 };
  let turns = 0;
  let lastText = "";

  emit({ type: "step.started", data: { task: req.task, model: req.model, tools: tools.map((t) => t.name), apiKeySource: "gemini" } });

  const fail = (error: string): SessionOutcome => {
    emit({ type: "step.failed", data: { error } });
    return { ok: false, text: lastText, costUsd: cost(), durationMs: Date.now() - started, numTurns: turns, error };
  };
  const cost = () => Math.round(((total.in * PRICE_IN + total.out * PRICE_OUT) / 1_000_000) * 1e6) / 1e6;
  const usage = (final: boolean) =>
    emit({ type: "usage.updated", data: { inputTokens: total.in, outputTokens: total.out, cacheReadTokens: total.cached, cacheCreationTokens: 0, costUsd: final ? cost() : null } });

  while (turns < req.agent.limits.maxTurns) {
    if (signal.aborted) return { ok: false, text: "", costUsd: cost(), durationMs: Date.now() - started, numTurns: turns, error: "cancelled" };
    if (cost() > req.budgetUsd && req.budgetUsd > 0 && PRICE_IN + PRICE_OUT > 0) return fail(`Step budget of $${req.budgetUsd.toFixed(2)} reached`);
    turns++;

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
      generationConfig: req.outputSchema ? { responseMimeType: "application/json" } : {},
    };
    let data: Response | null = null;
    for (let attempt = 0; ; attempt++) {
      if (!(await gate.acquire(signal))) return { ok: false, text: "", costUsd: cost(), durationMs: Date.now() - started, numTurns: turns, error: "cancelled" };
      let res: globalThis.Response;
      try {
        res = await fetch(`${API}/models/${encodeURIComponent(req.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (signal.aborted) return { ok: false, text: "", costUsd: cost(), durationMs: Date.now() - started, numTurns: turns, error: "cancelled" };
        return fail(`Could not reach the Gemini API: ${err instanceof Error ? err.message : String(err)}`);
      }
      const json = (await res.json().catch(() => ({}))) as Response;
      if (res.ok) {
        data = json;
        break;
      }
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      const info = geminiRetryInfo(json);
      const next = retryDecision({ engine: "Gemini", status: res.status, attempt, waitedMs: waited, maxWaitMs: waitLimit, retryAfterMs: info.retryAfterMs, daily: info.daily });
      if (next?.kind === "wait") {
        // Shared cool-down: the other running steps wait too instead of hitting the limit again.
        gate.cooldown(next.ms);
        waited += next.ms;
        emit({ type: "step.message", data: { messageId: randomUUID(), role: "system", partial: false, text: next.message } });
        continue;
      }
      return fail(next ? `${next.message}\n\n${explainGeminiError(res.status, msg)}` : explainGeminiError(res.status, msg));
    }
    if (!data) return fail("No response from Gemini");

    const u = data.usageMetadata ?? {};
    total.in += u.promptTokenCount ?? 0;
    total.out += (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    total.cached += u.cachedContentTokenCount ?? 0;
    usage(false);

    const candidate = data.candidates?.[0];
    if (!candidate?.content) return fail(data.promptFeedback?.blockReason ? `Gemini blocked the prompt: ${data.promptFeedback.blockReason}` : `Gemini returned no content (${candidate?.finishReason ?? "unknown reason"})`);
    const parts = candidate.content.parts ?? [];
    // The model turn goes back verbatim (keeps thoughtSignature parts intact).
    contents.push({ role: "model", parts });

    const messageId = randomUUID();
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
    for (const p of parts) if (p.thought && p.text) emit({ type: "step.thinking", data: { messageId, text: p.text } });
    if (text.trim()) {
      lastText = text;
      // Show the text arriving in pieces like a stream.
      for (const chunk of text.match(/[\s\S]{1,80}/g) ?? []) emit({ type: "step.message", data: { messageId, text: chunk, partial: true } });
      emit({ type: "step.message", data: { messageId, text, partial: false } });
    }

    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (calls.length === 0) break;

    const responses: Part[] = [];
    for (const call of calls) {
      const callId = call.id ?? `g-${randomUUID()}`;
      const input = call.args ?? {};
      emit({ type: "tool.called", data: { callId, tool: call.name, input } });
      if (call.name === "Skill" && typeof input.skill === "string") emit({ type: "skill.loaded", data: { name: input.skill } });
      const decision = await req.authorize(call.name, input);
      let ok = false;
      let output = "";
      if (!decision.allow) output = decision.reason;
      else {
        try {
          ({ ok, output } = await runLocalTool(call.name, input, req.workspace, signal));
        } catch (err) {
          output = err instanceof Error ? err.message : String(err);
        }
      }
      const shown = truncate(output);
      emit({ type: "tool.result", data: { callId, ok, output: shown.output, truncated: shown.truncated } });
      responses.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: ok ? { output } : { error: output } } });
    }
    contents.push({ role: "user", parts: responses });
  }

  usage(true);
  if (signal.aborted) return { ok: false, text: "", costUsd: cost(), durationMs: Date.now() - started, numTurns: turns, error: "cancelled" };
  if (!lastText.trim()) return fail(`Gemini stopped after ${turns} turn(s) without a final reply (turn limit ${req.agent.limits.maxTurns})`);

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
