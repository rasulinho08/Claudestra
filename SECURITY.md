# Security policy

Claudestra runs AI agents that can read and write files, run shell commands and use connected apps (GitHub, Google,
ClickUp, social media). Security reports are very welcome.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. Include what you found, how to reproduce it, and what an
attacker could do with it. You will get an answer within a few days; fixes are released as soon as they are ready,
and you are credited in the release notes unless you prefer not to be.

## What counts

Especially interesting:
- an agent escaping its run workspace (file tools, Bash, the built-in MCP servers in `apps/server/mcp/`)
- an action that should wait for approval running without it (`approvals.ts`, the never-auto list)
- server secrets (API keys, `GOOGLE_CLIENT_SECRET`, tokens) reaching an agent, a log or the browser
- login, role or CSRF bypasses on a team server (`access.ts`, `app.ts`)
- prompt injection from mail, documents or web pages that leads to an action without approval

Out of scope: problems that need an attacker who already has the owner role or access to the server's `.env`,
and behaviour of the AI models themselves.

## Running it safely

- Keep `.env` private; it is git-ignored. Never paste keys into issues or chats.
- On a server others can reach, turn on login (`AUTH_TOKEN` or users), use an API key (not a personal Claude
  login), and keep approvals on `smart` or `manual`. See `docs/12` and `docs/15`.
- Give each agent only the apps and tools it needs (`integrations` and `tools` in `agents/*.md`).
