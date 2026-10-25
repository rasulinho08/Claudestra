import { test } from "node:test";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { SdkEventMapper } from "../src/sdk-mapper.ts";
import { HookEventMapper } from "../src/hook-mapper.ts";
import { checkToolUse, isInside } from "../src/sandbox.ts";
import { resolveSdkAuth } from "../src/auth.ts";
import { RunStore } from "../src/store.ts";

const m = (x: unknown) => x as SDKMessage;

test("maps a full SDK session to step and run events", () => {
  const mapper = new SdkEventMapper("hi");
  const out = [
    m({ type: "system", subtype: "init", model: "claude-x", tools: ["Read"], apiKeySource: "oauth" }),
    m({ type: "stream_event", event: { type: "message_start", message: { id: "msg1" } }, parent_tool_use_id: null }),
    m({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } }, parent_tool_use_id: null }),
    m({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "msg1",
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.txt" } },
        ],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
      },
    }),
    m({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }] } }),
    m({ type: "result", subtype: "success", is_error: false, result: "Done", total_cost_usd: 0.01, duration_ms: 1200, num_turns: 2, usage: { input_tokens: 20, output_tokens: 9 } }),
  ].flatMap((x) => mapper.map(x));

  assert.deepEqual(out.map((e) => e.type), [
    "step.started", "step.message", "step.message", "tool.called", "usage.updated", "tool.result",
    "usage.updated", "step.succeeded",
  ]);
  assert.deepEqual(out[1]!.data, { messageId: "msg1", text: "Hel", partial: true, role: "assistant" });
  assert.equal((out[5]!.data as { output: string }).output, "file body");
  assert.deepEqual(mapper.outcome, { ok: true, text: "Done", structured: undefined, costUsd: 0.01, durationMs: 1200, numTurns: 2 });
});

test("dedupes usage when the SDK repeats an assistant message id", () => {
  const mapper = new SdkEventMapper("x");
  const msg = m({ type: "assistant", parent_tool_use_id: null, message: { id: "a", content: [], usage: { input_tokens: 10, output_tokens: 1 } } });
  mapper.map(msg);
  const [usage] = mapper.map(msg);
  assert.equal(usage?.type, "usage.updated");
  if (usage?.type === "usage.updated") assert.equal(usage.data.inputTokens, 10);
});

test("error results become step.failed with a failed outcome", () => {
  const mapper = new SdkEventMapper("x");
  const out = mapper.map(
    m({ type: "result", subtype: "error_max_budget_usd", is_error: true, errors: [], total_cost_usd: 0.5, usage: {}, duration_ms: 1, num_turns: 3 }),
  );
  assert.deepEqual(out.map((e) => e.type), ["usage.updated", "step.failed"]);
  assert.equal(mapper.outcome?.ok, false);
  assert.equal(mapper.outcome?.error, "error_max_budget_usd");
});

test("ignores subagent messages in phase 0", () => {
  assert.deepEqual(new SdkEventMapper("x").map(m({ type: "assistant", parent_tool_use_id: "p", message: { id: "z", content: [] } })), []);
});

test("sandbox confines paths and tools", () => {
  assert.ok(isInside("/w/run", "/w/run/a/b.txt"));
  assert.ok(isInside("/w/run", "notes.md"));
  assert.ok(!isInside("/w/run", "../other/x"));
  assert.ok(!isInside("/w/run", "/etc/passwd"));
  assert.deepEqual(checkToolUse("/w/run", "Write", { file_path: "/w/run/x" }), { allow: true });
  assert.equal(checkToolUse("/w/run", "Write", { file_path: "/home/me/x" }).allow, false);
  assert.equal(checkToolUse("/w/run", "NotebookEdit", { notebook_path: "x" }).allow, false);
});

test("auth modes", () => {
  assert.equal(resolveSdkAuth("api_key", {}).ok, false);
  const login = resolveSdkAuth("claude_cli_login", { ANTHROPIC_API_KEY: "k", PATH: "/bin" });
  assert.ok(login.ok && login.env.ANTHROPIC_API_KEY === undefined && login.env.PATH === "/bin");
  assert.equal(resolveSdkAuth("observer", {}).ok, false);
  const bedrock = resolveSdkAuth("bedrock", {});
  assert.ok(bedrock.ok && bedrock.env.CLAUDE_CODE_USE_BEDROCK === "1");
});

test("hook mapper pairs tool calls without tool_use_id", () => {
  const h = new HookEventMapper();
  const [called] = h.map("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } });
  const [result] = h.map("PostToolUse", { tool_name: "Bash", tool_response: { stdout: "a" } });
  assert.equal(called?.type, "tool.called");
  assert.equal(result?.type, "tool.result");
  if (called?.type === "tool.called" && result?.type === "tool.result") assert.equal(result.data.callId, called.data.callId);
  assert.deepEqual(h.map("Unknown", {}), []);
});

test("store assigns seq, projects status and cost, notifies listeners, survives reopen", () => {
  const store = new RunStore(":memory:");
  store.create({ id: "r1", prompt: "p", source: "claudestra" });
  const seen: number[] = [];
  store.subscribe("r1", (e) => seen.push(e.seq));
  store.append("r1", { type: "step.started", data: { task: "t", model: "m", tools: [] } }, { stepId: "s1", agentId: "coder" });
  store.append("r1", { type: "usage.updated", data: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.2, runCostUsd: 0.2 } }, { stepId: "s1" });
  store.append("r1", { type: "run.completed", data: { answer: "a", totalCostUsd: 0.25, durationMs: 1, numTurns: 1 } });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(store.status("r1"), "completed");
  assert.equal(store.list()[0]?.costUsd, 0.25);
  const events = store.events("r1");
  assert.equal(events[0]?.stepId, "s1");
  assert.equal(events[0]?.agentId, "coder");
  assert.deepEqual(store.events("r1", 2).map((e) => e.seq), [3]);
  assert.throws(() => store.append("r1", { type: "step.failed", data: {} } as never));
});

test("failInterrupted closes runs left running", () => {
  const store = new RunStore(":memory:");
  store.create({ id: "r1", prompt: "p", source: "claudestra" });
  store.create({ id: "obs-1", prompt: "p", source: "observer" });
  assert.equal(store.failInterrupted(), 1);
  assert.equal(store.status("r1"), "failed");
  assert.equal(store.status("obs-1"), "running");
});

test("authentication errors get a concrete fix", async () => {
  const { explainError } = await import("../src/sdk-mapper.ts");
  assert.match(explainError("Failed to authenticate: OAuth session expired"), /\/login/);
  assert.equal(explainError("boom"), "boom");
});
