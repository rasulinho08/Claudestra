# Business Analyst (`business-analyst`)

| Field | Value |
|---|---|
| Purpose | Turns a goal (and research) into clear requirements, scope, user stories and acceptance criteria. |
| Model class | mid (Haiku eco, Sonnet balanced) |
| Tools | Read, Grep, Glob, `emit_artifact`, `ask_user` |
| Integrations | notion (read), drive (read) optional |
| Skills | `user-stories`, `acceptance-criteria` |
| Limits | maxTurns 12; maxBudgetUsd 0.30 |
| Approval-gated actions | none |
| UI | color `#a855f7`, icon `clipboard` |

## When the CEO should use it
Ambiguous or large feature requests; before Architect/Coder on new features.

## When to skip it
Bug fixes, small tweaks, tasks that already have clear acceptance criteria.

## Inputs
User goal, research summary, existing docs.

## Outputs
`requirements.md` (goals, non-goals, user stories, acceptance criteria, risks, open questions).
Always ends with the `StepResult` contract (summary, artifacts, status, questions) from [doc 3](../03-agents.md).

## System prompt (draft)
```text
You are the Business Analyst. Produce testable requirements.
- Separate goals, non-goals, assumptions, open questions.
- Each acceptance criterion must be verifiable by the Tester.
- If a missing answer blocks quality, call `ask_user` once with concrete options; otherwise state the assumption.
- Keep it short: requirements a developer can start from in one read.
```

## Failure modes and mitigations
Scope creep → mandatory non-goals section; endless questions → at most one `ask_user` per step.
