# Claudestra

**An AI company you can watch work.** A CEO agent receives your prompt, decides which specialist agents are needed,
routes work between them, and streams every step to a live graph UI. Built on the Claude Agent SDK.
Local first, deploy later.

> Status: **all phases (0–5) implemented**: 11-agent company, approval modes, coder⇄reviewer loops, skills, MCP apps, workflows with a visual editor, triggers (schedule, webhook, GitHub), cross-run memory, login with roles, evals, templates, replay, cost analytics, and the animated robot **Stage** for a second monitor or OBS.

**No Claude account?** Use Google Gemini's free API: `AUTH_MODE=gemini` + `GEMINI_API_KEY` (docs/14).
**No AI at all?** Run `npm run demo` (or set `AUTH_MODE=demo` in `.env`) to try every screen with simulated agents ($0).

**Windows:** step-by-step cmd instructions are in [docs/14-running-on-windows.md](docs/14-running-on-windows.md). Problems? `npm run doctor`.

## Run it locally

Requirements: Node 22.13+ (uses the built-in `node:sqlite`), and either Claude Code logged in (`npm i -g @anthropic-ai/claude-code`, then run `claude` once
and sign in) or an Anthropic API key.

```bash
npm install
cp .env.example .env      # pick AUTH_MODE; default is claude_cli_login
npm run dev               # server http://127.0.0.1:8787 + web http://127.0.0.1:5173
```

Open http://127.0.0.1:5173 and give the company a task:

1. Pick an **approval mode** (Manual / Smart / Auto) and a **cost profile** (eco / balanced / max) next to the prompt.
2. The **CEO** decides the route: answer directly (one cheap call), one specialist, or a team plan.
3. The plan appears as a graph; nodes light up while their agent works, edges animate on handoffs.
   Switch to **Stage** to watch the Strativu robot carry the work between desks (doc 13).
4. Risky actions (shell commands outside a safe list, installs, `rm`, app write tools) wait in an approval bar.
5. Verifiers (reviewer, tester, security) can send the coder back for fixes; failed steps get a CEO review
   (retry / continue / stop). Pause, resume and stop any time.
6. The **Answer** tab shows the final answer and cost; **Files** shows the workspace; **Replay** re-watches a run
   for free; **Save as workflow** turns a good run into a reusable template.

Team (`agents/*.md`): CEO, Researcher, Business Analyst, Architect, Coder, Reviewer, Tester, Security Checker,
Doc Writer, Data Analyst, Project Manager. Edit them in the **Agents** page or the files. Skills live in
`skills/`, apps (MCP servers) in `integrations.json` (copy `integrations.example.json`; secrets come from `.env`).
Each run gets its own folder under `workspaces/`; file tools are confined to it and Bash runs there (inside the
OS sandbox on Linux/macOS). Runs, events, approvals and workflows are stored in `data/claudestra.db`.

Pages: **Runs** · **Workflows** (templates, visual editor, triggers, import/export) · **Agents** · **Skills** · **Apps** ·
**Memory** · **Evals** · **Costs** · **Users** · **▶ Stage window**.

Production-style: `npm run build && npm start` serves the app and API together on http://127.0.0.1:8787.

| Command | What it does |
|---|---|
| `npm run dev` | Server + web (web hot-reloads; server without auto-reload, reliable on Windows) |
| `npm run dev:watch` | Same, with server auto-reload for development (may hang on Windows) |
| `npm test` | Server tests (orchestrator, approvals, loops, workflows, store, SSE, hooks) and web tests (reducer, graph, stage) |
| `npm run typecheck` | TypeScript across all packages |
| `npm run build` | Production build of the web app |
| `npm start` | Server only; also serves the built web app on :8787 |
| `npm run doctor` | Checks Node, .env, Claude Code, port, and tries a server start |
| `npm run user -- add NAME owner` | Turn on login and create a user token (roles: owner, operator, viewer) |

### Observer mode (watch your normal Claude Code sessions)
Keep Claudestra running and add hooks to the project's `.claude/settings.json` that call
`node <path-to-claudestra>/apps/server/bin/claudestra-hook.mjs <EventName>` for `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `SubagentStop`, `Stop` and `SessionEnd` (full snippet in docs/11 §1.1 C).
Each Claude Code session appears as a run in the left list. Set `AUTH_MODE=observer` if you only want to watch.

## Layout

```
agents/            Agent definitions (YAML frontmatter + system prompt)
skills/            Skill library (one folder with SKILL.md per skill)
templates/         Workflow templates (gallery in the Workflows page)
evals/             Eval suites (Evals page)
integrations.example.json   MCP apps template (copy to integrations.json)
apps/server        Hono API, SSE, orchestrator, SDK sessions, SQLite store, observer hooks
apps/web           React Flow canvas, robot stage, inspector, library pages, costs
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
| 13 | [Stage & OBS](docs/13-stage-and-obs.md) | The animated robot view, second monitor and OBS setup |
| 14 | [Running on Windows](docs/14-running-on-windows.md) | cmd setup, daily use, troubleshooting |

Reading order: 1 → 2 → 3 → agent specs → 6 → 7 → 11.

SDK option names in these docs reflect the Claude Agent SDK as of writing. **Verify against the current SDK docs before implementing.**
