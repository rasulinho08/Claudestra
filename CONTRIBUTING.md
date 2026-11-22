# Contributing

Thanks for helping. Claudestra is documentation-first: the docs in `docs/` describe how things should work, and
the code follows them. A change that alters behaviour updates the matching doc in the same pull request.

## Getting started

Requirements: Node 22.13 or newer.

```bash
git clone <your fork>
cd claudestra
npm install
cp .env.example .env     # AUTH_MODE=demo works without any key
npm run dev              # server :8787, web :5173
```

`AUTH_MODE=demo` simulates every agent, so you can work on the UI, the orchestrator and the tests without an AI
account and without spending anything.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
```

All three must pass (CI runs them on every pull request). Add or update tests for what you change; tests live next
to the code they cover (`apps/server/test`, `apps/web/test`) and use Node's built-in test runner.

## Where things are

| Area | Files | Doc |
|---|---|---|
| Run lifecycle, approvals, loops | `apps/server/src/orchestrator.ts`, `approvals.ts` | docs/02, 04, 09 |
| Agents and skills | `agents/*.md`, `skills/*/SKILL.md` | docs/03, 05 |
| Apps (MCP) | `integrations.example.json`, `apps/server/mcp/` | docs/05, 16, 19, 21 |
| Event protocol (server ⇄ web) | `packages/protocol` | docs/06 |
| Web app | `apps/web/src` | docs/07 |

New agents, skills and workflow templates are the easiest way to contribute: they are plain Markdown or JSON.

## Ground rules

- Safety rules are not optional: anything that leaves the computer (sending, publishing, pushing, creating
  tasks) must go through approvals, and `auto` mode never bypasses the sandbox, budgets or the never-auto list.
- No secrets, personal data or real customer data in code, tests, examples or screenshots.
- Keep pull requests small and focused; describe what changed and how you tested it.
- Be kind. See `CODE_OF_CONDUCT.md`.
