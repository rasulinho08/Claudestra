// Claudestra's own implementations of the agent tools, for engines that are not Claude Code (AUTH_MODE=gemini).
// Same names and inputs as Claude Code's tools so the approval policy (approvals.ts) applies unchanged.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isInside } from "./sandbox.ts";

export type ToolDeclaration = { name: string; description: string; parameters: Record<string, unknown> };

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

export const TOOL_DECLARATIONS: Record<string, ToolDeclaration> = {
  Read: {
    name: "Read",
    description: "Read a text file from the workspace. Returns numbered lines.",
    parameters: { type: "object", properties: { file_path: str("Path relative to the workspace"), offset: int("First line (1-based), optional"), limit: int("Max lines, optional") }, required: ["file_path"] },
  },
  Write: {
    name: "Write",
    description: "Create or overwrite a file in the workspace with the given content.",
    parameters: { type: "object", properties: { file_path: str("Path relative to the workspace"), content: str("Full file content") }, required: ["file_path", "content"] },
  },
  Edit: {
    name: "Edit",
    description: "Replace an exact string in a workspace file. old_string must occur exactly once unless replace_all is true.",
    parameters: {
      type: "object",
      properties: { file_path: str("Path relative to the workspace"), old_string: str("Exact text to replace"), new_string: str("Replacement text"), replace_all: { type: "boolean", description: "Replace every occurrence" } },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  Glob: {
    name: "Glob",
    description: "List workspace files matching a glob pattern such as **/*.js.",
    parameters: { type: "object", properties: { pattern: str("Glob pattern") }, required: ["pattern"] },
  },
  Grep: {
    name: "Grep",
    description: "Search workspace files for a regular expression. Returns file:line: text matches.",
    parameters: { type: "object", properties: { pattern: str("Regular expression"), path: str("Sub-folder to search, optional") }, required: ["pattern"] },
  },
  Bash: {
    name: "Bash",
    description: "Run a shell command in the workspace folder (bash syntax). Returns stdout and stderr. Times out after 2 minutes.",
    parameters: { type: "object", properties: { command: str("The command to run") }, required: ["command"] },
  },
  WebFetch: {
    name: "WebFetch",
    description: "Fetch a web page and return its readable text (truncated).",
    parameters: { type: "object", properties: { url: str("http(s) URL") }, required: ["url"] },
  },
  WebSearch: {
    name: "WebSearch",
    description: "Search the web and return result titles and URLs (best effort).",
    parameters: { type: "object", properties: { query: str("Search query") }, required: ["query"] },
  },
};

const MAX_OUTPUT = 20_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".claude", "__pycache__", ".venv"]);

const cap = (text: string, max = MAX_OUTPUT) => (text.length > max ? `${text.slice(0, max)}\n… [${text.length - max} more characters]` : text);

function resolveIn(workspace: string, p: unknown): string {
  if (typeof p !== "string" || !p) throw new Error("a file path is required");
  const full = path.resolve(workspace, p);
  if (!isInside(workspace, full)) throw new Error(`${p} is outside the workspace`);
  return full;
}

async function walk(root: string, dir: string, out: string[], limit = 2000) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(root, full, out, limit);
    else if (e.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      re += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += pattern[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

// Git Bash on Windows (Claude Code needs it too); bash elsewhere.
function shellFor(): { file: string; args: (cmd: string) => string[] } {
  if (process.platform !== "win32") return { file: "bash", args: (cmd) => ["-c", cmd] };
  const candidates = [process.env.CLAUDESTRA_BASH, "C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].filter(Boolean) as string[];
  const bash = candidates.find((c) => existsSync(c));
  return bash ? { file: bash, args: (cmd) => ["-c", cmd] } : { file: "cmd.exe", args: (cmd) => ["/d", "/s", "/c", cmd] };
}

function runCommand(command: string, cwd: string, signal: AbortSignal, timeoutMs = 120_000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const shell = shellFor();
    const child = spawn(shell.file, shell.args(command), { cwd, env: process.env, windowsHide: true });
    let out = "";
    const add = (d: Buffer) => {
      if (out.length < MAX_OUTPUT * 2) out += d.toString("utf8");
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const kill = () => child.kill();
    const timer = setTimeout(() => {
      out += "\n[timed out after 2 minutes]";
      kill();
    }, timeoutMs);
    signal.addEventListener("abort", kill, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `could not start the shell: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      resolve({ ok: code === 0, output: cap(`${out}${code !== 0 ? `\n[exit code ${code}]` : ""}`.trim() || "(no output)") });
    });
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

async function webSearch(query: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "user-agent": "Mozilla/5.0 Claudestra" }, signal });
  const html = await res.text();
  const results: string[] = [];
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    let url = m[1]!;
    const real = /uddg=([^&]+)/.exec(url);
    if (real) url = decodeURIComponent(real[1]!);
    results.push(`- ${htmlToText(m[2]!)}\n  ${url}`);
    if (results.length >= 8) break;
  }
  return results.length ? results.join("\n") : "No results (the search service may be unavailable). Try WebFetch on a known URL.";
}

// Runs one tool call. Throws for bad input; returns { ok:false } for failed commands.
export async function runLocalTool(tool: string, input: Record<string, unknown>, workspace: string, signal: AbortSignal): Promise<{ ok: boolean; output: string }> {
  switch (tool) {
    case "Read": {
      const file = resolveIn(workspace, input.file_path);
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);
      const offset = Math.max(1, Number(input.offset) || 1);
      const limit = Math.min(Number(input.limit) || 2000, 5000);
      return { ok: true, output: cap(lines.slice(offset - 1, offset - 1 + limit).map((l, i) => `${offset + i}\t${l}`).join("\n")) };
    }
    case "Write": {
      const file = resolveIn(workspace, input.file_path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, String(input.content ?? ""), "utf8");
      return { ok: true, output: `File written: ${path.relative(workspace, file)}` };
    }
    case "Edit": {
      const file = resolveIn(workspace, input.file_path);
      const text = await readFile(file, "utf8");
      const oldS = String(input.old_string ?? "");
      const count = oldS ? text.split(oldS).length - 1 : 0;
      if (count === 0) return { ok: false, output: "old_string was not found in the file" };
      if (count > 1 && !input.replace_all) return { ok: false, output: `old_string occurs ${count} times; make it unique or set replace_all` };
      await writeFile(file, input.replace_all ? text.split(oldS).join(String(input.new_string ?? "")) : text.replace(oldS, String(input.new_string ?? "")), "utf8");
      return { ok: true, output: `Edited ${path.relative(workspace, file)}` };
    }
    case "Glob": {
      const files: string[] = [];
      await walk(workspace, workspace, files);
      const re = globToRegExp(String(input.pattern ?? "**/*"));
      const hits = files.filter((f) => re.test(f));
      return { ok: true, output: hits.length ? hits.slice(0, 500).join("\n") : "No files found" };
    }
    case "Grep": {
      const base = input.path ? resolveIn(workspace, input.path) : workspace;
      const files: string[] = [];
      await walk(workspace, base, files, 1000);
      const re = new RegExp(String(input.pattern ?? ""), "i");
      const out: string[] = [];
      for (const f of files) {
        const full = path.join(workspace, f);
        if ((await stat(full)).size > 1_000_000) continue;
        const lines = (await readFile(full, "utf8")).split(/\r?\n/);
        lines.forEach((l, i) => {
          if (out.length < 200 && re.test(l)) out.push(`${f}:${i + 1}: ${l.slice(0, 300)}`);
        });
      }
      return { ok: true, output: out.length ? out.join("\n") : "No matches" };
    }
    case "Bash":
      return runCommand(String(input.command ?? ""), workspace, signal);
    case "WebFetch": {
      const url = String(input.url ?? "");
      if (!/^https?:\/\//.test(url)) return { ok: false, output: "url must start with http:// or https://" };
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 Claudestra" }, signal });
      const type = res.headers.get("content-type") ?? "";
      const body = await res.text();
      return { ok: res.ok, output: cap(`HTTP ${res.status}\n\n${type.includes("html") ? htmlToText(body) : body}`, 12_000) };
    }
    case "WebSearch":
      return { ok: true, output: await webSearch(String(input.query ?? ""), signal) };
    default:
      return { ok: false, output: `Unknown tool ${tool}` };
  }
}
