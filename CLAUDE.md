# Instructions for the implementing model

This repo is **documentation-first**. The docs in `docs/` are the source of truth; implement them, do not redesign them.

## Order of work
1. Read `README.md`, then docs 1, 2, 3, 6, 7, 11 and `docs/agents/`.
2. Follow `docs/10-roadmap.md` phase by phase. Start with **Phase 0** (spike) and stop at each "Done when".
3. Layout: `apps/server`, `apps/web`, `packages/protocol`, `skills/`, `agents/`, `workspaces/` (git-ignored), `data/`.
4. Put shared Zod schemas for events/plan in `packages/protocol` first; server and web both import them.

## Rules
- Before using any Claude Agent SDK option, check the current official SDK docs (names change between versions).
- The UI state comes only from events (doc 6). No hidden client state.
- Default auth is `ANTHROPIC_API_KEY`. Never commit secrets; `.env` stays git-ignored.
- Every agent runs as its own SDK session under the orchestrator (doc 2, option B).
- Approval modes `manual | smart | auto` must exist from Phase 2. `auto` never bypasses sandbox, budgets, loop limits or redaction.
- Cost features (router, profiles, caps, summaries-not-transcripts, caching) are requirements, not extras (doc 11).
- Keep changes small and tested; run lint/typecheck/tests before committing.
- If a doc is wrong or unclear, fix the doc in the same commit as the code.

## Open questions to ask the owner before Phase 1
Primary use case, monthly API budget, Docker vs worktree for deploy (doc 10).
