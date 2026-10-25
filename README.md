# Claudestra

**An AI company you can watch work.** A CEO agent receives your prompt, decides which specialist agents are needed,
routes work between them, and streams every step to a live graph UI. Built on the Claude Agent SDK.
Local first, deploy later.

> Status: **Phase 0 done**: one agent streamed live to a web page, plus observer mode. Next: Phase 1 (docs/10).

## Run it locally

Requirements: Node 22+, and either Claude Code logged in (`npm i -g @anthropic-ai/claude-code`, then run `claude` once
and sign in) or an Anthropic API key.

```bash
npm install
cp .env.example .env      # pick AUTH_MODE; default is claude_cli_login
npm run dev               # server http://127.0.0.1:8787 + web http://127.0.0.1:5173
```

Open http://127.0.0.1:5173, type a prompt and watch messages, tool calls, tokens and cost stream in.
Each run gets its own folder under `workspaces/`; the Phase 0 agent can only read and write inside it
(tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch; no shell).

| Command | What it does |
|---|---|
| `npm run dev` | Server + web with reload |
| `npm test` | Server tests (mappers, sandbox, auth, SSE, hooks) |
| `npm run typecheck` | TypeScript across all packages |
| `npm run build` | Production build of the web app |

### Observer mode (watch your normal Claude Code sessions)
Keep Claudestra running and add hooks to the project's `.claude/settings.json` that call
`node <path-to-claudestra>/apps/server/bin/claudestra-hook.mjs <EventName>` for `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `SubagentStop`, `Stop` and `SessionEnd` (full snippet in docs/11 §1.1 C).
Each Claude Code session appears as a run in the left list. Set `AUTH_MODE=observer` if you only want to watch.

## Layout

```
apps/server        Hono API, SSE, Agent SDK runner, observer hooks   (src/, test/, bin/claudestra-hook.mjs)
apps/web           React page: run list, live timeline, cost header
packages/protocol  Zod event schemas shared by server and web
docs/              Design docs (source of truth)
```

## Highlights
- CEO decides the smallest team per task (direct answer, one agent, or a full plan) to save tokens.
- 10 specialists: Researcher, Business Analyst, Architect, Coder, Reviewer, Tester, Security Checker, Doc Writer, Data Analyst, Project Manager.
- Live node-graph canvas (React Flow), per-node inspector, replay, cost per step.
- Skills attachable per agent; apps via MCP (GitHub, Notion, Drive, ...) with per-tool permissions.
- Approval modes: **manual / smart / auto-approve**, chosen per run. Sandbox and budgets always apply.
- Save any good run as a reusable workflow (n8n-like), with a different core logic: agents decide, not fixed actions.
- Cost profiles `eco / balanced / max`, budgets, prompt caching, API-key billing by default.

## Documentation

| # | Doc | Answers |
|---|-----|---------|
| 1 | [Vision & scope](docs/01-vision-and-scope.md) | What, for whom, what is out of v1 |
| 2 | [Architecture](docs/02-architecture.md) | Components, flow, stack, key decisions |
| 3 | [Agents](docs/03-agents.md) | Roster, CEO planning loop, definition format |
| - | [Agent specs](docs/agents/README.md) | One spec per agent: prompt, tools, limits, gates |
| 4 | [Runs & workflows](docs/04-runs-and-workflows.md) | Dynamic vs saved workflows, step lifecycle, approval modes |
| 5 | [Skills, tools & integrations](docs/05-skills-tools-integrations.md) | Skills, MCP apps, permissions |
| 6 | [Event protocol](docs/06-event-protocol.md) | Events streamed to the UI |
| 7 | [UI spec](docs/07-ui-spec.md) | Canvas, inspector, replay, approvals |
| 8 | [Data model](docs/08-data-model.md) | SQLite tables |
| 9 | [Cost, safety & limits](docs/09-cost-safety-limits.md) | Budgets, sandbox, known limits |
| 10 | [Roadmap](docs/10-roadmap.md) | Phases, decisions made, open questions |
| 11 | [Claude connection & cost](docs/11-claude-connection-and-cost.md) | API key vs subscription, cost optimisation |
| 12 | [Local first & deploy](docs/12-local-first-and-deploy.md) | Local setup now, deploy checklist later |

Reading order: 1 → 2 → 3 → agent specs → 6 → 7 → 11.

SDK option names in these docs reflect the Claude Agent SDK as of writing. **Verify against the current SDK docs before implementing.**
