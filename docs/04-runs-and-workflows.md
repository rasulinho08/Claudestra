# 4. Runs & workflows

## Concepts

| Term | Meaning |
|---|---|
| **Run** | One execution started by one prompt |
| **Plan** | The graph of steps the CEO produced (or a workflow supplied) |
| **Step** | One agent doing one task; a node on the canvas |
| **Edge** | A dependency/handoff between steps |
| **Artifact** | A stored output of a step (markdown, JSON, file, diff, link list) |
| **Workflow** | A saved, reusable plan template with parameters |

## Two modes

### Dynamic (default)
Prompt → CEO plans → run. Nothing is predefined. Best for new tasks.

### Workflow (n8n-like)
A saved plan with fixed agents and edges, optionally with `{{variables}}`.
- Created via **"Save run as workflow"** after a good dynamic run, or authored as JSON/form.
- Running it skips `plan` (CEO still does `review` and `finalize` if enabled).
- Parameters: `{{prompt}}`, `{{repoUrl}}`, etc., filled at start.
- Later (v2): triggers — schedule, webhook, GitHub event.

```jsonc
{
  "id": "feature-from-idea",
  "name": "Feature from idea",
  "params": [{ "key": "idea", "type": "string" }],
  "steps": [
    { "id": "r", "agent": "researcher", "task": "Research prior art for: {{idea}}" },
    { "id": "ba", "agent": "business-analyst", "dependsOn": ["r"], "task": "Write requirements" },
    { "id": "c", "agent": "coder", "dependsOn": ["ba"], "task": "Implement" },
    { "id": "rv", "agent": "reviewer", "dependsOn": ["c"], "task": "Review", "loop": { "backTo": "c", "max": 2 } }
  ],
  "ceo": { "review": "on_failure", "finalize": true }
}
```

## Step lifecycle

```
pending ──▶ ready ──▶ running ──▶ succeeded
                         │  ▲
                         │  └── (retry / loop back)
                         ├──▶ waiting_approval ──▶ running | rejected
                         ├──▶ needs_input (question to CEO/user)
                         ├──▶ failed
                         └──▶ cancelled
```

Scheduling rule: a step becomes `ready` when all `dependsOn` are `succeeded`. Ready steps run in parallel up to
`maxConcurrentSteps` (default 3).

## Run states
`planning → running → (paused) → completed | failed | cancelled`

## Approval modes
Chosen globally (default) and overridable per run from the prompt box:

| Mode | Behaviour |
|---|---|
| `manual` | Plan approval required; every gated action asks the user |
| `smart` (default) | Plan runs without asking; only actions matching `requiresApproval` ask |
| `auto` | **Auto-approve**: plan and all gated actions are approved automatically (still logged as events with `by: "auto"`) |

Even in `auto`, these hard limits are never bypassed: sandbox path confinement, run/step budgets, loop limits,
wall-clock timeout, and the secret-redaction pass. Actions outside the sandbox (e.g. pushing to a remote, MCP *write*
tools on production systems) can be listed in `neverAuto` so they still prompt even in `auto`.

## Controls
- **Pause / resume** (between steps; running steps finish first)
- **Cancel** (aborts SDK sessions via abort controller)
- **Approve / reject** a gated action or the plan
- **Edit plan before start** (remove steps, change agent) — optional "plan approval" setting
- **Re-run step** (with edited instruction) — downstream steps invalidated

## Replay
All events are persisted with a monotonic `seq`. Replay = feed stored events through the same UI reducer at
1×/2×/10× speed. No re-execution, no cost.

## Context between runs (v2)
Run summaries stored per project; CEO may request "memory" of prior runs. Out of scope for v1.
