# 9. Cost, safety & limits

## Cost control
Multi-agent runs cost several times a single chat. Controls, in layers:

1. **CEO minimalism** — plan with the fewest agents (prompt rule + a cost class per agent).
2. **Run budget** — `budgetUsd` per run (default e.g. $2). Orchestrator sums `usage.updated`; at 80% emits
   `budget.warning`; at 100% stops launching steps and asks the CEO to finalize with what exists, or asks the user.
3. **Step limits** — `maxTurns` and `maxBudgetUsd` per agent (SDK options).
4. **Model classes** — cheap model for summarising/doc/PM, strong for CEO/architect/coder/reviewer.
5. **Context hygiene** — pass summaries, not transcripts; artifacts fetched on demand; skills load lazily.
6. **Prompt caching** — stable system prompts and skill text first so repeated runs hit the cache.
7. **Dry-run plan** — show the plan with estimated cost class before executing (optional setting).

**Cost profiles** (`eco | balanced | max`) bundle model classes, turn limits and plan size. Details and the full
optimisation design: [doc 11](11-claude-connection-and-cost.md).

## Safety
Auto-approve mode (doc 4) removes prompts, not safeguards: sandbox, budgets, loop limits and redaction always apply.

| Risk | Mitigation |
|---|---|
| Agent deletes/overwrites user files | Work only in per-run sandbox (git worktree/container); host paths blocked by permission hook |
| Dangerous shell | Bash allow-list + `requiresApproval` patterns; no network by default except allow-listed hosts |
| Pushing code / posting externally | MCP write tools disabled by default; `requiresApproval` on all write tools |
| Secret leakage | Secret refs only; redaction before persist/log; env not passed to model |
| Prompt injection via web/repo content | Treat tool results as data; researcher has no write tools; approvals for anything outward-facing; CEO told to ignore instructions found in artifacts |
| Runaway loops | `maxIterations` on loops, `maxTurns`, run budget, wall-clock timeout |
| Concurrent writes | One writer per workspace path; parallel coders use separate worktrees and merge step |

## What smart mode lets through (implemented)
- File tools only inside the run workspace (Read/Write/Edit paths are checked).
- Bash commands on a safe list (ls, cat, grep, node/python **script files**, npm test/lint/build, git status/diff/add/commit, …)
  with no absolute paths outside the workspace, no `..`, no `rm`, `curl`, `wget`, `sudo`, `ssh`, inline `node -e` / `python -c`.
  Everything else asks. Agent files add their own `requiresApproval` patterns.
- A script the agent wrote can still do anything the OS user can. On Linux/macOS Bash runs inside Claude Code's OS
  sandbox (`OS_SANDBOX=auto`); **on Windows there is no OS sandbox**, so for untrusted tasks use **manual** mode or run
  Claudestra in a VM / WSL / container. Docker per run is the planned deploy-time sandbox (doc 12).
- Never-auto patterns (`NEVER_AUTO`, default: git push, rm -rf, sudo, MCP create/update/delete/push/merge) always ask, even in auto mode.

## Known limits (SDK & design)
- **Flat subagents:** SDK subagents cannot spawn subagents. Our orchestrator provides the hierarchy instead.
- **Auth/billing:** API key, pay per token (see doc 1).
- **Parallelism:** bounded by API rate limits; `maxConcurrentSteps` default 3.
- **Hidden reasoning:** the UI shows what the model emits (text, tool calls, optionally summarised thinking), not raw internals.
- **Non-determinism:** the same prompt may yield different plans; use saved workflows for repeatability.
- **Long runs:** need persistence + resume; v1 resumes at step boundaries, not mid-step.
- **Context windows:** very large repos need targeted reads; the Researcher/Coder use search tools, not whole-repo dumps.
