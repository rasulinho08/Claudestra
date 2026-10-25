# Instructions for the implementing model

This repo is **documentation-first**. The docs in `docs/` are the source of truth; implement them, do not redesign them.

## Current state
Phases 0–5 are implemented (see docs/10 "Implementation notes"). Run `npm test` and `npm run typecheck` before
and after changes.
Server: `orchestrator.ts` (run lifecycle, approvals, pause, loops, reviews), `session.ts` (one SDK session per step),
`approvals.ts` (policy), `plan.ts` (CEO prompts, validation), `store.ts` (SQLite), `workflows.ts`, `skills.ts`,
`integrations.ts`, `analytics.ts`, `app.ts` (HTTP). Web: `run-state.ts` (event reducer), `RunsPage.tsx`,
`graph.ts` + `Canvas.tsx` (React Flow), `stage/` (robot view: `world.ts` logic, `draw.ts` rendering), `pages/`.
Phase 5 extras: `memory.ts`, `access.ts` (login/roles), `triggers.ts` + `cron.ts`, `evals.ts`, `runs.ts` (shared run launcher),
web `WorkflowEditor.tsx` and pages Memory, Evals, Users. Windows instructions: docs/14.

## Order of work
1. Read `README.md`, then docs 1, 2, 3, 6, 7, 11 and `docs/agents/`.
2. Follow `docs/10-roadmap.md` phase by phase. Start with **Phase 0** (spike) and stop at each "Done when".
3. Layout: `apps/server`, `apps/web`, `packages/protocol`, `skills/`, `agents/`, `workspaces/` (git-ignored), `data/`.
4. Put shared Zod schemas for events/plan in `packages/protocol` first; server and web both import them.

## Rules
- Before using any Claude Agent SDK option, check the current official SDK docs (names change between versions).
- The UI state comes only from events (doc 6). No hidden client state.
- Auth is a single `AUTH_MODE` setting (`api_key | claude_cli_login | observer | bedrock | vertex`, doc 11 §1.1). Start local with `claude_cli_login`; `api_key` is required for deploy. Never commit secrets; `.env` stays git-ignored.
- Every agent runs as its own SDK session under the orchestrator (doc 2, option B).
- Approval modes `manual | smart | auto` must exist from Phase 2. `auto` never bypasses sandbox, budgets, loop limits or redaction.
- Cost features (router, profiles, caps, summaries-not-transcripts, caching) are requirements, not extras (doc 11).
- Keep changes small and tested; run lint/typecheck/tests before committing.
- If a doc is wrong or unclear, fix the doc in the same commit as the code.

## Open questions to ask the owner before Phase 1
Primary use case, monthly API budget, Docker vs worktree for deploy (doc 10).
