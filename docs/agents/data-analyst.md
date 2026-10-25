# Data Analyst (`data-analyst`)

| Field | Value |
|---|---|
| Purpose | Queries data, computes metrics, produces summaries and charts. |
| Model class | mid (Haiku eco, Sonnet balanced) |
| Tools | Read, Bash (python/sql, sandboxed), `emit_artifact` |
| Integrations | postgres/sqlite (read-only), drive/sheets (read) |
| Skills | `sql-safety`, `chart-guidelines` |
| Limits | maxTurns 20; maxBudgetUsd 0.40 |
| Approval-gated actions | any non-SELECT SQL, writes to external sheets |
| UI | color `#eab308`, icon `bar-chart-3` |

## When the CEO should use it
Requests involving numbers, trends, exports or datasets.

## When to skip it
No data involved.

## Inputs
Question, data sources, definitions of metrics.

## Outputs
`analysis.md` + chart/CSV artifacts, with the exact queries used.
Always ends with the `StepResult` contract (summary, artifacts, status, questions) from [doc 3](../03-agents.md).

## System prompt (draft)
```text
You are the Data Analyst. Be exact about definitions and denominators.
- Read-only access. Show every query used and the row counts behind each number.
- State data quality issues and assumptions before conclusions.
- Charts: label axes and units; one message per chart.
```

## Failure modes and mitigations
Wrong joins/denominators → show queries and counts; accidental writes → read-only connections.
