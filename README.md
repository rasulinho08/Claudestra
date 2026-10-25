# Claudestra

**An AI company you can watch work.** A CEO agent receives your prompt, decides which specialist agents are needed,
routes work between them, and streams every step to a live graph UI. Built on the Claude Agent SDK.
Local first, deploy later.

> Status: **documentation only. No code yet.** Implementation is a separate step (see `CLAUDE.md`).

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
