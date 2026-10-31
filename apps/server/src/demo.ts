// AUTH_MODE=demo: a simulated agent session so the whole app (graph, stage robot, approvals, loops, replay)
// can be tried without any AI provider. Nothing is sent anywhere and every cost is $0; files written by the
// "coder" are real files in the run workspace. Outputs are clearly marked as simulated.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EventData } from "@claudestra/protocol";
import type { SessionRequest, SessionRunner } from "./session.ts";
import type { SessionOutcome } from "./sdk-mapper.ts";
import { runLocalTool } from "./local-tools.ts";

const SPEED = Math.max(0.1, Number(process.env.DEMO_SPEED) || 1);
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms / SPEED);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

const has = (text: string, re: RegExp) => re.test(text.toLocaleLowerCase("az"));
// Unicode-aware word boundaries: \b treats letters such as ə, ş, ç as non-word characters.
const words = (list: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(${list})(?![\\p{L}\\p{N}_])`, "u");
const BUILD_VERBS = words("build|make|create|write|code|implement|fix|program|develop|generate|yarat|düzəlt|yaz|qur|hazırla|kodla");
const SLUG_SKIP = new Set(["build", "make", "create", "write", "code", "implement", "please", "with", "that", "this", "some", "simple", "hello", "claude", "for", "and", "the"]);

export function requestOf(prompt: string): string {
  return (/<request>\s*([\s\S]*?)\s*<\/request>/.exec(prompt)?.[1] ?? /# Client request\n([\s\S]*?)(\n\n# |$)/.exec(prompt)?.[1] ?? prompt).trim();
}

// Keyword planner standing in for the CEO's judgement.
export function demoPlan(request: string, cap: number) {
  const r = request.toLocaleLowerCase("az");
  const wantsCode = has(r, BUILD_VERBS);
  const isQuestion = /\?\s*$/.test(request.trim()) || has(r, new RegExp(`^(what|who|when|where|why|how|which|nə|nədir|kim|niyə|necə|hansı)(?![\\p{L}\\p{N}_])`, "u"));
  if (isQuestion && !wantsCode && request.length < 160) {
    return { route: "direct", summary: "A short question: the CEO answers directly.", directAnswer: `(demo) This is a simulated answer to: "${request}". With a real AI connected, the CEO would answer here in one cheap call.`, steps: [] };
  }
  const steps: { id: string; agent: string; task: string; dependsOn: string[]; successCriteria: string; loopBackTo: string }[] = [];
  const add = (agent: string, task: string, dependsOn: string[] = [], loopBackTo = "") => {
    const id = `s${steps.length + 1}`;
    steps.push({ id, agent, task, dependsOn, successCriteria: "", loopBackTo });
    return id;
  };
  let last: string[] = [];
  if (has(r, words("research|find|compare|latest|search|sources?|araşdır|tap|müqayisə|axtar")) || !wantsCode) last = [add("researcher", `Research the background for: ${request}`)];
  if (has(r, words("requirements?|user stor|spec|tələb\\p{L}*"))) last = [add("business-analyst", "Write requirements.md with acceptance criteria.", last)];
  if (has(r, words("design|architecture|plan|dizayn|arxitektura"))) last = [add("architect", "Write design.md with a file-level plan.", last)];
  if (wantsCode) {
    const code = add("coder", `Implement: ${request}`, last);
    last = [code];
    if (has(r, words("tests?|test\\p{L}*|yoxla"))) last = [add("tester", "Write and run tests for the implementation.", last, code)];
    last = [add("reviewer", "Review the implementation and request changes if needed.", last, code)];
    if (has(r, /(secur|safe|auth|təhlükəsiz)/u)) last = [add("security", "Check the code for security issues.", last, code)];
  }
  if (wantsCode && has(r, words("design|style|css|beautiful|pretty|dizayn|gözəl|stil\\p{L}*"))) last = [add("designer", "Polish the look: layout, colours, accessibility.", last)];
  if (has(r, words("market\\p{L}*|landing|slogan|posts?|reklam\\p{L}*|satış"))) last = [add("marketer", "Write the marketing copy.", last)];
  if (has(r, words("translat\\p{L}*|tərcümə\\p{L}*|english|ingilis\\p{L}*|rus\\p{L}*"))) last = [add("translator", "Translate the texts.", last)];
  if (has(r, /(docs?|readme|document|sənəd)/u) || !wantsCode) add("doc-writer", wantsCode ? "Write a README for the result." : "Write report.md from the research.", last);
  return { route: steps.length === 1 ? "single_agent" : "team", summary: `Demo plan with ${steps.length} step(s) chosen from keywords in the request.`, directAnswer: "", steps: steps.slice(0, cap) };
}

// Each verifier asks for changes once per run, so the fix loop is visible.
const askedForChanges = new Set<string>();

type Tool = { tool: string; input: Record<string, unknown>; output: string; run?: () => Promise<void> };

function toolsFor(req: SessionRequest, request: string): Tool[] {
  const slug = (request.toLocaleLowerCase("az").match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 3 && !SLUG_SKIP.has(w)).slice(0, 2).join("-") || "result";
  const file = (rel: string, content: string): Tool => ({
    tool: "Write",
    input: { file_path: path.join(req.workspace, rel), content },
    output: `File created successfully at: ${rel}`,
    run: async () => {
      await mkdir(path.dirname(path.join(req.workspace, rel)), { recursive: true });
      await writeFile(path.join(req.workspace, rel), content, "utf8");
    },
  });
  switch (req.agent.info.id) {
    case "researcher":
      return [
        { tool: "WebSearch", input: { query: request.slice(0, 80) }, output: "(demo) 5 results: example.org/guide, example.org/docs, …" },
        { tool: "WebFetch", input: { url: "https://example.org/guide" }, output: "(demo) Page summary: key facts about the topic." },
      ];
    case "business-analyst":
      return [file("requirements.md", `# Requirements (demo)\n\n- As a user I want ${request}\n- Acceptance: it works for the basic case\n`)];
    case "architect":
      return [file("design.md", `# Design (demo)\n\n- index.html: UI\n- app.js: logic\n`)];
    case "coder":
      return [
        { tool: "Glob", input: { pattern: "**/*" }, output: "(demo) workspace files listed" },
        file(`${slug}.js`, `// (demo) generated for: ${request}\nexport function main(input) {\n  return \`Result for \${input}\`;\n}\n`),
        { tool: "Bash", input: { command: "npm install left-pad" }, output: "(demo) added 1 package" },
        { tool: "Bash", input: { command: `node ${slug}.js` }, output: "(demo) ran without errors" },
      ];
    case "tester":
      return [file(`${slug}.test.js`, `// (demo) tests\nimport assert from "node:assert";\nassert.ok(true);\n`), { tool: "Bash", input: { command: `node ${slug}.test.js` }, output: "(demo) 3 tests passed" }];
    case "reviewer":
    case "security":
      return [{ tool: "Read", input: { file_path: path.join(req.workspace, `${slug}.js`) }, output: "(demo) file contents" }];
    case "doc-writer":
      return [file("README.md", `# ${request.slice(0, 60)} (demo)\n\nHow to use the result.\n`)];
    case "designer":
      return [file("style.css", ":root { --accent: #f59e0b; --bg: #fff; }\n/* (demo) styles */\nbody { font-family: system-ui, sans-serif; }\n")];
    case "translator":
      return [file("README.en.md", `# (demo) English version\n\n${request.slice(0, 80)}\n`)];
    case "marketer":
      return [file("marketing/copy.md", `# (demo) Landing copy\n\n## Headline options\n1. …\n2. …\n3. …\n`)];
    case "data-analyst":
      return [{ tool: "Bash", input: { command: "python3 analyse.py" }, output: "(demo) rows: 120, mean: 42" }, file("analysis.md", "# Analysis (demo)\n")];
    default:
      return [file("status.md", "# Status (demo)\n\nDone.\n")];
  }
}

function reportFor(req: SessionRequest, request: string): string {
  const id = req.agent.info.id;
  const verifier = id === "reviewer" || id === "tester" || id === "security";
  if (verifier) {
    const key = `${req.workspace}:${id}`;
    const first = !askedForChanges.has(key);
    askedForChanges.add(key);
    return first
      ? `VERDICT: CHANGES REQUESTED\n- (demo) high: handle empty input in the main function.\n\n## Summary\n(demo) One must-fix finding: empty input.`
      : `VERDICT: APPROVE\n(demo) The fix handles empty input.\n\n## Summary\n(demo) Approved after one fix round.`;
  }
  return `(demo) ${req.agent.info.name} finished: ${req.task.slice(0, 160)}\n\nThis text is simulated. With a real AI connected, the agent would do the actual work for "${request.slice(0, 120)}".\n\n## Summary\n(demo) ${req.agent.info.name} completed its part and saved its files in the workspace.`;
}

export const demoSession: SessionRunner = async (req): Promise<SessionOutcome> => {
  const started = Date.now();
  const signal = req.controller.signal;
  const emit = (e: EventData) => !signal.aborted && req.emit(e);
  const request = requestOf(req.prompt);
  emit({ type: "step.started", data: { task: req.task, model: `demo (${req.model})`, tools: req.agent.tools, apiKeySource: "demo" } });

  const stream = async (text: string) => {
    const messageId = `demo-${randomUUID()}`;
    for (const chunk of text.match(/.{1,24}(\s|$)|\S+/gs) ?? [text]) {
      if (signal.aborted) return;
      emit({ type: "step.message", data: { messageId, text: chunk, partial: true } });
      await sleep(45, signal);
    }
    emit({ type: "step.message", data: { messageId, text, partial: false } });
  };
  const usage = (n: number, final = false) =>
    emit({ type: "usage.updated", data: { inputTokens: 200 * n, outputTokens: 60 * n, cacheReadTokens: 900 * n, cacheCreationTokens: 0, costUsd: final ? 0 : null } });
  const done = (text: string, structured?: unknown): SessionOutcome => {
    usage(3, true);
    if (signal.aborted) return { ok: false, text: "", costUsd: 0, durationMs: Date.now() - started, numTurns: 0, error: "cancelled" };
    emit({ type: "step.succeeded", data: { summary: text.slice(0, 300), costUsd: 0, durationMs: Date.now() - started } });
    return { ok: true, text, structured, costUsd: 0, durationMs: Date.now() - started, numTurns: 3 };
  };

  // CEO: planning, failure review, final answer.
  if (req.agent.info.id === "ceo") {
    if (req.outputSchema && req.prompt.includes("MODE: REVIEWING")) return done("", { action: "continue", revisedTask: "", note: "(demo) continue without this step" });
    if (req.outputSchema) {
      await stream("(demo) Reading the request and choosing the smallest team…");
      const cap = Number(/at most (\d+) steps/.exec(req.prompt)?.[1] ?? 6);
      const plan = demoPlan(request, cap);
      emit({ type: "tool.called", data: { callId: "plan", tool: "StructuredOutput", input: plan } });
      emit({ type: "tool.result", data: { callId: "plan", ok: true, output: "Structured output provided successfully", truncated: false } });
      return done(JSON.stringify(plan), plan);
    }
    await sleep(600, signal);
    const answer = `(demo) Final answer for "${request}".\n\nThe team finished in simulated mode: the plan, handoffs, approvals and the fix loop you saw are real app behaviour; the texts are placeholders. Files the agents wrote are in the Files tab.\n\nConnect Claude (AUTH_MODE=claude_cli_login or api_key) for real results.`;
    await stream(answer);
    return done(answer);
  }

  // Specialists: think, use tools (through the real approval policy), report.
  await stream(`(demo) Starting: ${req.task.slice(0, 120)}`);
  usage(1);
  // Skills 2.0: show the agent opening its first skill, with the real SKILL.md text.
  const skillCalls: Tool[] = [];
  if (req.skills?.length) {
    const loaded = await runLocalTool("Skill", { skill: req.skills[0]! }, req.workspace, signal).catch(() => ({ ok: false, output: "" }));
    if (loaded.ok) skillCalls.push({ tool: "Skill", input: { skill: req.skills[0]! }, output: loaded.output.slice(0, 600) });
  }
  for (const t of [...skillCalls, ...toolsFor(req, request)]) {
    if (signal.aborted) break;
    const callId = `demo-${randomUUID()}`;
    emit({ type: "tool.called", data: { callId, tool: t.tool, input: t.input } });
    if (t.tool === "Skill") emit({ type: "skill.loaded", data: { name: String(t.input.skill) } });
    const decision = await req.authorize(t.tool, t.input);
    await sleep(1400, signal);
    if (!decision.allow) {
      emit({ type: "tool.result", data: { callId, ok: false, output: decision.reason, truncated: false } });
      continue;
    }
    await t.run?.();
    emit({ type: "tool.result", data: { callId, ok: true, output: t.output, truncated: false } });
    usage(2);
  }
  const report = reportFor(req, request);
  await stream(report);
  return done(report);
};
