---
name: architecture-decision-records
description: Use when a technical choice is hard to reverse or affects several files or agents, to record it as a short ADR with context, decision, alternatives and consequences.
---
# Architecture decision records

An ADR is a short Markdown note that explains one decision so later agents do not re-argue it.

## When to write one
Write an ADR when the choice:
- is costly to undo (storage format, file layout, data model, framework or no framework);
- affects more than one agent or role (an API shape the designer and coder both rely on);
- picks between real alternatives that someone could reasonably prefer;
- accepts a known trade-off (e.g. "no build step, so no TypeScript").
Do not write one for naming, formatting or choices the task already fixed.

## Steps
1. Look in `docs/adr/` for existing ADRs; reuse the numbering and do not contradict an accepted one silently.
2. Create `docs/adr/NNNN-short-title.md` (`0003-store-data-in-json-file.md`), one decision per file.
3. Context: the problem and the forces (requirements, constraints, what must stay true). Facts only;
   say where a fact comes from (task text, user story, measurement you ran).
4. Decision: one or two sentences in active voice: "We store items in `data/items.json`."
5. Alternatives: at least two options you did not pick, each with the reason it lost.
6. Consequences: what gets easier, what gets harder, and what follow-up work it creates.
7. Set status: `proposed` (needs reviewer or owner), `accepted`, or `superseded by NNNN`.
8. Link the ADR from the place where the decision shows (README, PLAN.md task, code comment at the entry point).

## Changing a decision
Never edit an accepted ADR's decision. Write a new ADR, set the old one to `superseded by NNNN`,
and explain in the new Context what changed.

## Output format
```markdown
# 0003. Store data in a JSON file
**Status:** accepted   **Date:** 2026-10-31   **Deciders:** architect, reviewer

## Context
The app runs on one PC, holds under ~1000 items (task text), and must work without installs.

## Decision
We store all items in `data/items.json`, written atomically (write temp file, then rename).

## Alternatives
- SQLite via node:sqlite: more robust queries, but experimental in Node 22 and overkill for this size.
- localStorage: no file access needed, but data stays in one browser and cannot be backed up easily.

## Consequences
+ Human-readable, easy to back up and diff.
- Whole file rewritten on each save; revisit if items exceed ~10 000.
Follow-up: T7 add a test for a corrupted file.
```

## Rules
- Keep each ADR under one screen; link to longer analysis instead of pasting it.
- Write in English; quote Azerbaijani requirement text verbatim if the decision depends on it.
- Do not claim benchmarks or numbers you did not measure; write "not measured" instead.
