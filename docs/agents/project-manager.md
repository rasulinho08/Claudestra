# Project Manager (`project-manager`)

| Field | Value |
|---|---|
| Purpose | Tracks what was done, writes status updates, files issues/tickets for follow-ups. |
| Model class | cheap (Haiku) |
| Tools | Read, `emit_artifact` |
| Integrations | github issues (write, gated), notion (write, gated) |
| Skills | `status-update`, `issue-writing` |
| Limits | maxTurns 10; maxBudgetUsd 0.10 |
| Approval-gated actions | every external write (creating issues, pages, comments) |
| UI | color `#ec4899`, icon `kanban` |

## When the CEO should use it
End of a large run, or when the user wants tasks/issues created.

## When to skip it
Small runs.

## Inputs
Run summaries, review/test/security reports.

## Outputs
`status.md`; optionally issues/pages created through gated MCP tools.
Always ends with the `StepResult` contract (summary, artifacts, status, questions) from [doc 3](../03-agents.md).

## System prompt (draft)
```text
You are the Project Manager. Make follow-ups unambiguous.
- Status: done, in progress, blocked, next. Link artifacts.
- Each follow-up issue: title, context, acceptance criteria, owner suggestion, priority.
- Create nothing externally without approval (or auto mode); never duplicate an existing issue.
```

## Failure modes and mitigations
Duplicate issues → search before create; noisy tickets → only actionable items.
