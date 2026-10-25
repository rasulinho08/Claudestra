# 6. Event protocol

Everything the UI shows is derived from a stream of events. The UI holds **no hidden state**: the same events,
replayed, reproduce the same screen.

## Envelope

```ts
type ClaudestraEvent = {
  seq: number;          // monotonic per run, used for resume (Last-Event-ID) and replay
  runId: string;
  ts: string;           // ISO time
  stepId?: string;      // present for step-scoped events
  agentId?: string;
  type: EventType;
  data: unknown;        // typed per event below
};
```

## Transport
`GET /runs/:id/events` (SSE). `Last-Event-ID: <seq>` resumes. Stored events are replayed first, then live.
`GET /runs/:id/events?from=0&speed=...` is for replay mode (server paces) — or the client paces locally.

## Event types

### Run level
| type | data |
|---|---|
| `run.started` | `{ prompt, mode, workflowId?, budgetUsd }` |
| `run.paused` / `run.resumed` | `{}` |
| `run.completed` | `{ answer, totalCostUsd, durationMs, steps }` |
| `run.failed` | `{ error }` |
| `run.cancelled` | `{ by }` |

### CEO / planning
| type | data |
|---|---|
| `ceo.thinking` | `{ mode: "plan"\|"review"\|"decide"\|"finalize", text }` (streamed deltas) |
| `plan.created` | `{ plan: Plan }` → UI draws all nodes as `pending` |
| `plan.updated` | `{ plan: Plan, reason }` (insert/remove steps, re-plan) |
| `plan.approval_requested` / `plan.approved` / `plan.rejected` | `{}` |

### Step level
| type | data |
|---|---|
| `step.ready` | `{}` |
| `step.started` | `{ task, model, tools, skills, integrations }` |
| `step.message` | `{ messageId, role: "assistant"\|"user"\|"system", text, partial }`; deltas share `messageId` with the final text |
| `step.thinking` | `{ text }` (if extended thinking is surfaced) |
| `step.handoff` | `{ from: stepId, to: stepId, summary, artifactIds }` → animated edge |
| `step.needs_input` | `{ question, options? }` |
| `step.approval_requested` | `{ action, tool, input, reason }` |
| `step.approved` / `step.rejected` | `{ by }` |
| `step.succeeded` | `{ summary, artifactIds, usage, costUsd, durationMs }` |
| `step.failed` | `{ error, retryable }` |
| `step.retrying` | `{ attempt, reason }` |

### Tools, skills, artifacts
| type | data |
|---|---|
| `tool.called` | `{ callId, tool, input, integration? }` |
| `tool.result` | `{ callId, ok, output (truncated), outputRef? }` |
| `tool.denied` | `{ tool, reason }`: the permission policy refused a call (sandbox, disabled tool) |
| `skill.loaded` | `{ name }` |
| `artifact.created` | `{ id, kind, title, path?, bytes }` |
| `file.changed` | `{ path, op: "create"\|"modify"\|"delete", diffRef? }` |

### Usage
| type | data |
|---|---|
| `usage.updated` | `{ stepId?, inputTokens, outputTokens, cacheRead, costUsd, runTotalUsd }` |
| `budget.warning` / `budget.exceeded` | `{ spentUsd, limitUsd }` |

## Mapping SDK messages → events (Agent Runner)

| SDK message | Becomes |
|---|---|
| `system` / init | `step.started` (model, tools, MCP status) |
| `assistant` text block | `step.message` |
| `assistant` tool_use block | `tool.called` (+ `skill.loaded` if the Skill tool) |
| `user` tool_result block | `tool.result` |
| partial stream events (if enabled) | `step.message` with `partial: true` |
| `result` | `step.succeeded` / `step.failed` + `usage.updated` |
| Hook `PreToolUse` | permission decision → maybe `step.approval_requested` |
| Hook `PostToolUse` on Write/Edit | `file.changed` |

Because each step is its own `query()`, attribution is trivial (no need to infer from `parent_tool_use_id`).
If an agent uses SDK subagents internally, their events are nested under the step using that field.

## Observer mode
Claude Code hook payloads (`POST /hooks/:event`) are mapped to the same events: one run per `session_id`
(`obs-<session_id>`), `UserPromptSubmit` → `step.message` (role user), `PreToolUse`/`PostToolUse` → `tool.called`/`tool.result`,
`SessionEnd` → `run.completed`. Implemented in `apps/server/src/hook-mapper.ts`.

## Persistence & size
- Tool outputs over N KB are truncated in the event and stored in full as an artifact (`outputRef`).
- Events are append-only. Redaction runs before insert.
