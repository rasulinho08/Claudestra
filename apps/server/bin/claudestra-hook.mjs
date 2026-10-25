#!/usr/bin/env node
// Claude Code hook → Claudestra (observer mode). Usage in .claude/settings.json:
//   "command": "node /path/to/claudestra/apps/server/bin/claudestra-hook.mjs PreToolUse"
// Must never block or fail Claude Code: short timeout, always exits 0, prints nothing.
const event = process.argv[2] ?? "unknown";
const base = process.env.CLAUDESTRA_URL ?? "http://127.0.0.1:8787";

let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (body += chunk));
process.stdin.on("end", async () => {
  try {
    await fetch(`${base}/hooks/${encodeURIComponent(event)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body || "{}",
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Claudestra not running: ignore.
  }
  process.exit(0);
});
