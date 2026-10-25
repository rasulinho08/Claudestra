# 10. Roadmap

## Phase 0 — Spike (1–2 days) ✅ done
- One `query()` call streamed to a bare web page, with `AUTH_MODE=claude_cli_login`.
- Also: a minimal `/hooks/:event` endpoint for observer mode.
- **Done when:** you see messages and tool calls appear live, with token cost.

## Phase 1 — Core loop (week 1) ✅ done
- Monorepo, shared protocol package, SQLite, event bus, SSE.
- CEO `plan` → 3 agents (Researcher, Coder, Reviewer) → CEO `finalize`.
- React Flow canvas: nodes, statuses, edges, inspector "Live" tab.
- **Done when:** a prompt produces a plan graph, nodes light up in order, answer appears, cost shown.
- Shipped extras: CEO router (`direct | single_agent | team`), parallel steps, run budget with skip + warning,
  per-step reports saved as artifacts, auto layout that picks horizontal or vertical to fit the screen.

## Phase 2 — Full roster & control (week 2) ✅ done
- All 10 agents, agent definition files, Agents screen.
- Parallel steps, coder⇄reviewer loop, CEO `review`, retries, pause/cancel.
- Budgets and warnings.
- **Done when:** simple prompt uses ≤2 agents; complex prompt uses ≥5; budget stop works.

## Phase 3 — Skills & apps (week 3) ✅ done
- Skill library + attach to agents; lazy loading; `skill.loaded` events.
- MCP integrations registry (GitHub, web, Notion, Drive), per-tool allow-lists, secrets.
- Approval gates and sandbox/worktree.
- **Done when:** Researcher uses GitHub MCP read tools; Coder write needs approval; skill usage visible on node.

## Phase 4 — Workflows & replay (week 4) ✅ done
- Save run as workflow, parameters, run workflow, versioning.
- Replay scrubber, run history, artifacts browser, diffs.
- **Done when:** a saved workflow re-runs with new params; any old run replays identically.

## Phase 5 — Polish & v2 ideas (partly done)
Done: cost analytics page (per agent, model, day, top steps), daily/monthly budget caps, cost profiles,
agent and skill editors in the UI, the animated robot Stage for a second monitor / OBS (doc 13),
single-port production mode (`npm start`).
Still open:
- Drag-and-drop workflow editing, triggers (cron/webhook/GitHub events), cross-run memory,
  multi-user + auth, agent evals (score agents on benchmark tasks), templates marketplace.

## Decisions already made
| Topic | Decision |
|---|---|
| Name / repo | **Claudestra**, `rasulinho08/Claudestra` |
| Hosting | Local first, deploy later (doc 12) |
| Approvals | `manual / smart / auto` selectable, default `smart` (doc 4) |
| Agent hierarchy | Own orchestrator, one SDK session per step (doc 2) |
| Auth | Start local with Claude login (`claude_cli_login`) or `observer`; API key (`api_key`) before deploy. Implement all modes behind one `AUTH_MODE` setting (doc 11 §1.1) |
| Sandbox | Git worktree in v1 (simple); Docker adapter added before deploy |
| Custom agents | Agents are data files; creating new ones in the UI is supported from Phase 2 |

## Implementation notes (Phases 2–5)
- Approval modes: `apps/server/src/approvals.ts` (safe Bash list, `Tool:argGlob` patterns, never-auto list); waits and
  decisions in `orchestrator.ts`; UI approval bar, inline buttons and plan modal.
- Verifier loop: a plan step with `loopBackTo` re-runs the target step with the verifier's findings (new nodes
  `s1-r2`, `s2-r2`) until `VERDICT: APPROVE` or `MAX_LOOP_ITERATIONS`.
- Failures: CEO review (structured) → retry (once, `MAX_RETRIES_PER_STEP`), continue, or finish.
- Skills are copied into `<workspace>/.claude/skills/` per agent and enabled with the SDK `skills` option.
- MCP: `integrations.json` + `${ENV}` secrets; per-agent `integrations: ["server:toolGlob"]`.
- Workflows: SQLite `workflows` + `workflow_versions`; runs skip CEO planning.

## Open questions
1. **Primary use case** to optimise first: software building, research reports, or business analysis? (Default assumption: software building.)
2. **Monthly API budget** the owner is comfortable with, to set default `budgetUsd` and the daily cap.
3. **Docker vs worktree** for the deploy phase.
