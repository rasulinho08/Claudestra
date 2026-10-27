import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Orchestrator } from "../src/orchestrator.ts";
import { RunStore } from "../src/store.ts";
import { geminiSession } from "../src/gemini.ts";
import { globToRegExp, runLocalTool } from "../src/local-tools.ts";
import { testAgents, testConfig } from "./helpers.ts";

type Call = { url: string; body: { contents: { role: string; parts: Record<string, unknown>[] }[]; systemInstruction: { parts: { text: string }[] }; tools?: unknown; generationConfig?: { responseMimeType?: string } } };

// Fake Gemini: CEO plans one coder step; the coder writes a file with a function call, then reports.
function fakeGemini(opts: { rateLimitFirst?: boolean } = {}) {
  const calls: Call[] = [];
  let limited = !opts.rateLimitFirst;
  const reply = (parts: unknown[], status = 200) =>
    new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } }), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Call["body"];
    calls.push({ url: String(url), body });
    if (!limited) {
      limited = true;
      return new Response(JSON.stringify({ error: { code: 429, message: "quota", details: [{ retryDelay: "0.01s" }] } }), { status: 429 });
    }
    const system = body.systemInstruction.parts[0]!.text;
    if (system.includes("You are the CEO")) {
      if (body.generationConfig?.responseMimeType === "application/json") {
        return reply([{ text: JSON.stringify({ route: "team", summary: "code it", directAnswer: "", steps: [{ id: "s1", agent: "coder", task: "write hello.js", dependsOn: [], successCriteria: "", loopBackTo: "" }, { id: "s2", agent: "doc-writer", task: "write README.md", dependsOn: ["s1"], successCriteria: "", loopBackTo: "" }] }) }]);
      }
      return reply([{ text: "Done: hello.js and README.md are ready." }]);
    }
    const last = body.contents.at(-1)!;
    if (last.role === "user" && last.parts[0]?.functionResponse) return reply([{ text: "I wrote the file.\n## Summary\nhello.js created." }]);
    const file = system.includes("Doc Writer") ? "README.md" : "hello.js";
    return reply([{ functionCall: { id: "c1", name: "Write", args: { file_path: file, content: "console.log('hi')\n" } }, thoughtSignature: "sig" }]);
  };
  return { calls, fetchImpl };
}

test("gemini engine: plans, calls tools through the approval policy, writes files, retries 429", async () => {
  const { calls, fetchImpl } = fakeGemini({ rateLimitFirst: true });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl as typeof fetch;
  try {
    const workspacesDir = mkdtempSync(path.join(tmpdir(), "cls-gem-"));
    const store = new RunStore();
    const env = { GEMINI_API_KEY: "k" };
    const orch = new Orchestrator(testConfig({ workspacesDir }), store, testAgents(), {
      runSession: (req) => geminiSession({ ...req, env: { ...req.env, ...env } }),
    });
    store.create({ id: "g", prompt: "write hello.js and docs", source: "claudestra" });
    await orch.start("g", { prompt: "write hello.js and docs", profile: "balanced", approvalMode: "smart" });
    const events = store.events("g");
    assert.equal(store.status("g"), "completed", JSON.stringify(events.filter((e) => e.type === "run.failed" || e.type === "step.failed")));
    assert.ok(existsSync(path.join(workspacesDir, "g", "hello.js")));
    assert.ok(existsSync(path.join(workspacesDir, "g", "README.md")));
    assert.ok(events.some((e) => e.type === "step.message" && e.data.role === "system" && /retrying/.test(e.data.text)));
    // The model turn with its thoughtSignature is sent back unchanged, followed by the functionResponse.
    const followUp = calls.find((c) => c.body.contents.some((m) => m.parts.some((p) => p.functionResponse)))!;
    assert.equal(followUp.body.contents[1]!.parts[0]!.thoughtSignature, "sig");
    assert.deepEqual((followUp.body.contents[2]!.parts[0]!.functionResponse as { id: string }).id, "c1");
    assert.match(calls[1]!.url, /models\/m-strong:generateContent$/);
    const done = events.at(-1)!;
    assert.ok(done.type === "run.completed" && /hello\.js/.test(done.data.answer));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("local tools: read, edit, glob, grep stay inside the workspace", async () => {
  const ws = mkdtempSync(path.join(tmpdir(), "cls-tools-"));
  writeFileSync(path.join(ws, "a.js"), "const x = 1;\nconst y = 2;\n");
  const signal = new AbortController().signal;
  assert.match((await runLocalTool("Read", { file_path: "a.js" }, ws, signal)).output, /1\tconst x = 1;/);
  assert.equal((await runLocalTool("Edit", { file_path: "a.js", old_string: "x = 1", new_string: "x = 3" }, ws, signal)).ok, true);
  assert.match(readFileSync(path.join(ws, "a.js"), "utf8"), /x = 3/);
  assert.equal((await runLocalTool("Glob", { pattern: "**/*.js" }, ws, signal)).output, "a.js");
  assert.match((await runLocalTool("Grep", { pattern: "y = 2" }, ws, signal)).output, /a\.js:2:/);
  await assert.rejects(runLocalTool("Read", { file_path: "../../etc/passwd" }, ws, signal), /outside the workspace/);
  assert.ok(globToRegExp("src/**/*.ts").test("src/a/b.ts"));
  assert.ok(globToRegExp("**/*.md").test("README.md"));
  const bash = await runLocalTool("Bash", { command: "echo hi" }, ws, signal);
  assert.equal(bash.output, "hi");
});
