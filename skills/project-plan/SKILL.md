---
name: project-plan
description: Use when turning a goal into a plan (PLAN.md) with milestones, tasks owned by agent roles, dependencies, risks with mitigations, and a status format to track progress.
---
# Project plan

Write `PLAN.md` in the workspace. One or two screens; a plan nobody reads is worse than no plan.

## Steps
1. Restate the goal in one sentence and add a **Done when** line that a reviewer can check with yes/no
   ("A static site with 3 pages opens offline and passes the test plan").
2. List constraints you were actually given (deadline, budget, platform, language, e.g. Azerbaijani + English).
   Anything you guessed goes under **Assumptions**; anything only the owner can answer goes under **Open questions**.
3. Cut the work into 2–5 milestones. Each milestone ends in something visible (a file, a page, a passing test).
4. Break each milestone into tasks of roughly one agent session each. A task has: ID, verb-first title,
   owner role, inputs, output file(s), and depends-on IDs.
5. Assign owners only from the real roles: architect, coder, designer, tester, reviewer, security, doc-writer,
   data-analyst, researcher, marketer, translator, project-manager. One owner per task.
6. Check dependencies: no cycles, no task depends on a later milestone, and parallel tasks do not write the same file.
7. Mark the critical path (the longest chain of dependencies); start there.
8. List 3–6 risks, each with likelihood, impact and a concrete mitigation or fallback.
9. Add review gates: tester after coder, reviewer before a milestone is closed, security when input, auth or files are handled.

## Task rules
- Outputs are files with relative paths (`src/app.js`, `docs/research.md`), not "progress".
- No estimates in hours unless asked; use S / M / L size.
- Do not plan installs or paid tools; the workspace has Node.js, Python and a browser.
- Never invent facts about the client, market or users; route unknowns to researcher or Open questions.

## Output format
```markdown
# Plan: <goal>
**Done when:** ...
**Constraints:** ... **Assumptions:** ... 

## Milestones
- M1 Prototype: index.html opens and shows the list
- M2 Data: items saved and reloaded

| ID | Task | Owner | Depends on | Output | Size | Status |
|----|------|-------|-----------|--------|------|--------|
| T1 | Write user stories | project-manager | – | docs/stories.md | S | todo |
| T2 | Design page layout | designer | T1 | docs/layout.md | S | todo |
| T3 | Build list page | coder | T1,T2 | index.html, app.js | M | todo |
| T4 | Test list page | tester | T3 | TEST-PLAN.md | S | todo |

**Critical path:** T1 → T2 → T3 → T4

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Azerbaijani letters break sorting | M | M | Use localeCompare('az'); add test case |

## Open questions
- ...
```

## Status updates
Status values: `todo | doing | blocked | review | done`. When something changes, edit the table and add a
dated line under **Log**: `2026-10-31 T3 blocked: waiting for layout (T2). Next: designer.`
A blocked task always names what it waits for and who unblocks it.
