#!/usr/bin/env node
// `npm run doctor`: checks everything Claudestra needs and says what to fix. Plain Node, no build step.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let problems = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m, fix) => {
  problems++;
  console.log(`  FAIL  ${m}\n        → ${fix}`);
};
const warn = (m, fix) => console.log(`  WARN  ${m}${fix ? `\n        → ${fix}` : ""}`);

console.log("Claudestra doctor\n");

// Node
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj > 22 || (maj === 22 && min >= 13)) ok(`Node ${process.version}`);
else bad(`Node ${process.version} is too old`, "install Node 22.13+ (nodejs.org LTS), close and reopen cmd, run npm install");

try {
  await import("node:sqlite");
  ok("node:sqlite available");
} catch (e) {
  bad("node:sqlite not available", "install Node 22.13 or newer");
}

// Dependencies
if (existsSync(path.join(root, "node_modules", "tsx")) && existsSync(path.join(root, "node_modules", "@anthropic-ai", "claude-agent-sdk"))) ok("dependencies installed");
else bad("dependencies missing", "run: npm install");

// .env
const envPath = path.join(root, ".env");
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  ok(".env found");
} else bad(".env missing", "run: copy .env.example .env");

const mode = env.AUTH_MODE || "claude_cli_login";
const modes = ["api_key", "claude_cli_login", "observer", "bedrock", "vertex"];
if (modes.includes(mode)) ok(`AUTH_MODE=${mode}`);
else bad(`AUTH_MODE=${mode} is not valid`, `use one of: ${modes.join(", ")}`);
if (mode === "api_key" && !env.ANTHROPIC_API_KEY) bad("AUTH_MODE=api_key but ANTHROPIC_API_KEY is empty", "paste your key into .env or use AUTH_MODE=claude_cli_login");

// Claude Code CLI (login mode)
if (mode === "claude_cli_login") {
  const claude = spawnSync(process.platform === "win32" ? "claude.cmd" : "claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (claude.status === 0) ok(`Claude Code ${claude.stdout.trim()}`);
  else bad("Claude Code CLI not found", "run: npm install -g @anthropic-ai/claude-code   then: claude   (log in once)");
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const creds = [path.join(home, ".claude", ".credentials.json"), path.join(home, ".claude.json")];
  if (creds.some((p) => existsSync(p))) ok("Claude Code has been set up on this computer (the login itself is checked when a run starts)");
  else warn("no Claude Code login data found", "run `claude` and log in (or check with `claude` that it opens without asking to log in)");
}

// Git Bash on Windows (Claude Code's Bash tool)
if (process.platform === "win32") {
  const git = spawnSync("git", ["--version"], { encoding: "utf8", shell: true });
  if (git.status === 0) ok(git.stdout.trim());
  else warn("Git for Windows not found", "install it from git-scm.com so agents can run shell commands");
}

// Port
const port = Number(env.PORT || 8787);
const free = await new Promise((resolve) => {
  const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
  s.listen(port, env.HOST || "127.0.0.1");
});
if (free) ok(`port ${port} is free`);
else warn(`port ${port} is in use`, "a Claudestra server may already be running (fine), or another program uses it: set PORT in .env");

// Server start test
if (problems === 0 && free) {
  console.log("\n  Trying to start the server for 25 s…");
  const r = spawnSync(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "src/main.ts"], {
    cwd: path.join(root, "apps", "server"),
    encoding: "utf8",
    timeout: 25_000,
    env: { ...process.env, PORT: String(port) },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (/Claudestra server on/.test(out)) ok("server starts");
  else bad("server did not start", "see its output below and send it if unclear");
  console.log(out.split(/\r?\n/).map((l) => `        | ${l}`).join("\n"));
}

console.log(problems === 0 ? "\nAll good. Start with: npm run dev   then open http://127.0.0.1:5173" : `\n${problems} problem(s) to fix (see above).`);
process.exit(problems === 0 ? 0 : 1);
