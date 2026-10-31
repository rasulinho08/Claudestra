import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Orchestrator } from "../src/orchestrator.ts";
import { RunStore } from "../src/store.ts";
import { compatEndpoint, compatSession } from "../src/openai-compat.ts";
import { resolveSdkAuth } from "../src/auth.ts";
import { testAgents, testConfig } from "./helpers.ts";

type Body = { model: string; messages: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }[]; tools?: unknown[]; response_format?: unknown };

function fakeMeta(opts: { rejectJsonSchema?: boolean; rateLimitFirst?: boolean } = {}) {
  const calls: { url: string; auth: string | null; body: Body }[] = [];
  let limited = !opts.rateLimitFirst;
  const reply = (message: unknown) =>
    new Response(JSON.stringify({ choices: [{ message, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { status: 200 });
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
    if (!limited) {
      limited = true;
      return new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429, headers: { "retry-after": "0.01" } });
    }
    if (opts.rejectJsonSchema && body.response_format) return new Response(JSON.stringify({ error: { message: "response_format is not supported" } }), { status: 400 });
    const system = body.messages[0]!.content ?? "";
    if (system.includes("You are the CEO")) {
      if (/JSON schema/.test(body.messages[1]!.content ?? "")) {
        return reply({ role: "assistant", content: JSON.stringify({ route: "team", summary: "build", directAnswer: "", steps: [{ id: "s1", agent: "coder", task: "write calc.js", dependsOn: [], successCriteria: "", loopBackTo: "" }, { id: "s2", agent: "doc-writer", task: "write README.md", dependsOn: ["s1"], successCriteria: "", loopBackTo: "" }] }) });
      }
      return reply({ role: "assistant", content: "Done: calc.js and README.md." });
    }
    const last = body.messages.at(-1)!;
    if (last.role === "tool") return reply({ role: "assistant", content: "Wrote the file.\n## Summary\nfile created." });
    const file = system.includes("Doc Writer") ? "README.md" : "calc.js";
    return reply({ role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Write", arguments: JSON.stringify({ file_path: file, content: "x\n" }) } }] });
  };
  return { calls, fetchImpl };
}

async function runWith(fake: ReturnType<typeof fakeMeta>, env: Record<string, string>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake.fetchImpl as typeof fetch;
  try {
    const workspacesDir = mkdtempSync(path.join(tmpdir(), "cls-meta-"));
    const store = new RunStore();
    const orch = new Orchestrator(testConfig({ workspacesDir }), store, testAgents(), { runSession: (req) => compatSession({ ...req, env: { ...req.env, ...env } }) });
    store.create({ id: "m", prompt: "make a calculator", source: "claudestra" });
    await orch.start("m", { prompt: "make a calculator", profile: "balanced", approvalMode: "smart" });
    return { store, ws: path.join(workspacesDir, "m") };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("meta engine: plans, calls tools, writes files, retries 429, sends Bearer key to api.meta.ai", async () => {
  const fake = fakeMeta({ rateLimitFirst: true });
  const { store, ws } = await runWith(fake, { AUTH_MODE: "meta", META_API_KEY: "mk" });
  const events = store.events("m");
  assert.equal(store.status("m"), "completed", JSON.stringify(events.filter((e) => e.type === "run.failed" || e.type === "step.failed")));
  assert.ok(existsSync(path.join(ws, "calc.js")) && existsSync(path.join(ws, "README.md")));
  assert.equal(fake.calls[0]!.url, "https://api.meta.ai/v1/chat/completions");
  assert.equal(fake.calls[0]!.auth, "Bearer mk");
  assert.ok(fake.calls.some((c) => c.body.response_format));
  const followUp = fake.calls.find((c) => c.body.messages.some((m) => m.role === "tool"))!;
  assert.equal(followUp.body.messages.find((m) => m.role === "tool")!.tool_call_id, "call_1");
  assert.ok(events.some((e) => e.type === "step.message" && e.data.role === "system" && /continuing automatically/.test(e.data.text)));
});

test("openai_compat: falls back when response_format is rejected; config errors are clear", async () => {
  const fake = fakeMeta({ rejectJsonSchema: true });
  const { store } = await runWith(fake, { AUTH_MODE: "openai_compat", OPENAI_BASE_URL: "http://localhost:11434/v1/", OPENAI_MODEL: "llama" });
  assert.equal(store.status("m"), "completed");
  assert.equal(fake.calls[0]!.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(fake.calls[0]!.auth, null);
  assert.ok("error" in compatEndpoint({ AUTH_MODE: "meta" }));
  assert.ok("error" in compatEndpoint({ AUTH_MODE: "openai_compat", OPENAI_BASE_URL: "x" }));
  assert.equal(resolveSdkAuth("meta", { META_API_KEY: "k" }).ok, true);
  assert.equal(resolveSdkAuth("meta", {}).ok, false);
});

test("openai_compat presets: OpenRouter needs a key, Ollama and LM Studio are local and keyless", async () => {
  const { compatEndpoint } = await import("../src/openai-compat.ts");
  const ep = (env: Record<string, string>) => compatEndpoint({ AUTH_MODE: "openai_compat", ...env });
  assert.match((ep({ OPENAI_PROVIDER: "openrouter", OPENAI_MODEL: "x" }) as { error: string }).error, /OPENAI_API_KEY.*openrouter\.ai\/keys/);
  const or = ep({ OPENAI_PROVIDER: "openrouter", OPENAI_MODEL: "x", OPENAI_API_KEY: "k" });
  assert.ok(!("error" in or) && or.baseUrl === "https://openrouter.ai/api/v1" && or.headers["x-title"] === "Claudestra" && !or.local);
  const ol = ep({ OPENAI_PROVIDER: "Ollama", OPENAI_MODEL: "qwen3:8b" });
  assert.ok(!("error" in ol) && ol.baseUrl === "http://127.0.0.1:11434/v1" && ol.local && ol.apiKey === "");
  assert.ok(!("error" in ep({ OPENAI_PROVIDER: "lm-studio", OPENAI_MODEL: "m" })));
  assert.match((ep({ OPENAI_PROVIDER: "ollama" }) as { error: string }).error, /OPENAI_MODEL=qwen3:8b/);
  assert.match((ep({ OPENAI_PROVIDER: "nope", OPENAI_MODEL: "m" }) as { error: string }).error, /unknown/);
  const custom = ep({ OPENAI_BASE_URL: "http://localhost:8080/v1/", OPENAI_MODEL: "m" });
  assert.ok(!("error" in custom) && custom.local && custom.baseUrl === "http://localhost:8080/v1");
});
