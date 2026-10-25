// Tool-call policy: sandbox, agent allow-lists, approval gates and approval modes (docs/05 "Permission model").
import type { ApprovalMode } from "@claudestra/protocol";
import { checkToolUse } from "./sandbox.ts";

// `by` is set when a gated call was approved without asking (auto mode or an "approve for this run" rule); it is logged as an event.
export type Gate = { kind: "allow"; by?: "auto" | "rule"; reason?: string } | { kind: "deny"; reason: string } | { kind: "ask"; reason: string; key: string; neverAuto: boolean };

// Bash commands that may run without approval in smart mode: read-only or local checks.
const SAFE_BASH = new Set([
  "ls", "cat", "head", "tail", "wc", "pwd", "echo", "printf", "grep", "rg", "find", "sort", "uniq", "diff", "file", "stat",
  "mkdir", "touch", "cp", "mv", "true", "test", "node", "python", "python3", "tsc", "jq", "sed", "awk", "tr", "cut", "basename", "dirname", "date",
]);
const SAFE_BASH_PREFIXES = [
  "npm test", "npm run test", "npm run lint", "npm run typecheck", "npm run build", "npx tsc", "npx vitest", "npx jest", "npx eslint",
  "pytest", "python -m pytest", "python3 -m pytest", "go test", "go vet", "cargo test", "cargo check",
  "git status", "git diff", "git log", "git show", "git init", "git add", "git commit",
];
const RISKY_BASH = /(\bsudo\b|\brm\s|\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\bgit\s+push\b|\bnpm\s+publish\b|\bchmod\b|\bchown\b|\bdd\b|\bmkfs\b|>\s*\/|\s~\/|\.\.\/)/;

const normalizePath = (p: string) => p.replace(/\\/g, "/").replace(/^([a-z]):/i, (_, d: string) => `${d.toLowerCase()}:`);

export function splitCommand(command: string): string[] {
  return command.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);
}

export function isSafeBash(command: string, workspace: string): boolean {
  if (RISKY_BASH.test(command)) return false;
  // Absolute paths (POSIX or Windows drive paths) must stay inside the workspace.
  const ws = normalizePath(workspace);
  for (const m of command.matchAll(/(?:^|[\s'"=])(\/[^\s'"]+|[A-Za-z]:[\\/][^\s'"]*)/g)) {
    const p = normalizePath(m[1]!);
    if (!p.startsWith(ws) && !p.startsWith("/dev/null") && !p.startsWith("/tmp/")) return false;
  }
  return splitCommand(command).every((segment) => {
    const words = segment.split(/\s+/).filter((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w));
    const first = words[0] ?? "";
    if (first === "find" && /\s-(delete|exec)/.test(segment)) return false;
    // Inline interpreter code (node -e, python -c) could do anything; only script files in the workspace run freely.
    if (["node", "python", "python3"].includes(first) && words.some((w) => /^-(e|c|p|-eval|-print)$/.test(w))) return false;
    if (SAFE_BASH.has(first)) return true;
    const joined = words.join(" ");
    return SAFE_BASH_PREFIXES.some((p) => joined === p || joined.startsWith(`${p} `));
  });
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "s");
}

export function primaryArg(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  if (tool === "Bash") return pick("command") ?? "";
  if (tool === "WebFetch") return pick("url") ?? "";
  if (tool === "WebSearch") return pick("query") ?? "";
  return pick("file_path") ?? pick("path") ?? pick("pattern") ?? JSON.stringify(input);
}

// "Tool" or "Tool:argGlob"; the tool part may itself be a glob (e.g. "mcp__*__create_*").
export function matchesPattern(pattern: string, tool: string, input: Record<string, unknown>): boolean {
  const idx = pattern.startsWith("mcp__") ? pattern.indexOf(":", pattern.lastIndexOf("__")) : pattern.indexOf(":");
  const toolGlob = idx >= 0 ? pattern.slice(0, idx) : pattern;
  if (!globToRegex(toolGlob).test(tool)) return false;
  if (idx < 0) return true;
  const re = globToRegex(pattern.slice(idx + 1));
  const arg = primaryArg(tool, input);
  return re.test(arg) || (tool === "Bash" && splitCommand(arg).some((s) => re.test(s)));
}

export type PolicyInput = {
  mode: ApprovalMode;
  workspace: string;
  agentName: string;
  agentTools: string[];
  mcpAllowed: (tool: string) => boolean;
  requiresApproval: string[];
  neverAuto: string[];
  approvedForRun: Set<string>;
};

export function evaluate(p: PolicyInput, tool: string, input: Record<string, unknown>): Gate {
  const isMcp = tool.startsWith("mcp__");
  if (isMcp) {
    if (!p.mcpAllowed(tool)) return { kind: "deny", reason: `${tool} is not enabled for ${p.agentName}` };
  } else if (tool !== "Skill" && !p.agentTools.includes(tool)) {
    return { kind: "deny", reason: `${tool} is not enabled for ${p.agentName}` };
  }
  if (!isMcp && tool !== "Skill") {
    const sandbox = checkToolUse(p.workspace, tool, input);
    if (!sandbox.allow) return { kind: "deny", reason: sandbox.reason };
  }

  const reasons: string[] = [];
  const matched = p.requiresApproval.find((pat) => matchesPattern(pat, tool, input));
  if (matched) reasons.push(`matches ${matched}`);
  if (tool === "Bash" && !isSafeBash(primaryArg(tool, input), p.workspace)) reasons.push("command is outside the safe list");
  const neverAuto = p.neverAuto.some((pat) => matchesPattern(pat, tool, input));
  if (reasons.length === 0 && !neverAuto) return { kind: "allow" };

  const key = `${tool}:${primaryArg(tool, input)}`;
  const reason = reasons.join("; ") || "never auto-approved";
  if (p.approvedForRun.has(tool) && !neverAuto) return { kind: "allow", by: "rule", reason };
  if (p.mode === "auto" && !neverAuto) return { kind: "allow", by: "auto", reason };
  return { kind: "ask", reason, key, neverAuto };
}
