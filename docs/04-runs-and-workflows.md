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

## Triggers (implemented)
Per workflow, in the Workflows page:
- **Schedule**: 5-field cron in server-local time (`0 9 * * 1-5` = weekdays 09:00). Checked every 15 s, fired once per minute.
- **Webhook**: `POST /api/triggers/<id>/fire` with `?secret=…` or header `X-Claudestra-Secret`, or from GitHub with the
  trigger secret as the webhook secret (signature checked). JSON string fields become workflow params; GitHub events
  fill `prompt`, `title`, `body`, `repo`, `url`, `github_event`, `github_action`.
- Each trigger has its own profile and approval mode (default eco + smart). Caps apply. Runs record `origin: trigger:<id>`.

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

Implemented: `DEFAULT_APPROVAL_MODE` in `.env`, per-run choice in the prompt box, "Approve for run" adds a
run-wide rule for that tool (never for never-auto actions), and every automatic approval is logged as
`step.approved` with `by: "auto"` or `by: "rule"`.

## Controls
- **Pause / resume** (between steps; running steps finish first)
- **Cancel** (aborts SDK sessions via abort controller)
- **Approve / reject** a gated action or the plan
- **Edit plan before start** (remove steps, change agent) — optional "plan approval" setting
- **Re-run step** (with edited instruction) — downstream steps invalidated

## Replay
All events are persisted with a monotonic `seq`. Replay = feed stored events through the same UI reducer at
1×/2×/10× speed. No re-execution, no cost.

## Context between runs
Memory (notes and recall of related runs) is implemented (docs/10). Projects add file continuity:

## Projects (implemented, upgrade A3)
A **project** is a folder that keeps its files between runs: a Claudestra folder (`projects/<id>/`, git-ignored) or a
real folder on this PC linked by its full path (only when the server runs locally; drive roots, the home folder,
system folders and Claudestra's own folders are refused).

1. **Start**: `POST /api/runs {projectId}` copies the project's files into the run workspace (skipping `.git`,
   `node_modules`, `.claude`, `.venv`, `__pycache__`, in any letter case; ≤5000 files, ≤200 MB) and stores a baseline of
   hashes in the database (`project_runs.baseline`), never in the agent-writable workspace. Agents only ever work on that copy. Every prompt gets a project note: the project
   name, its files and the last tasks in it (with "(applied)" marks), so the CEO plans to change files in place.
2. **Review**: `GET /api/runs/:id/changes` lists added / modified / deleted files against the baseline with text
   for a line diff; `conflict` marks files that changed in the project folder after the run started.
3. **Apply**: `POST /api/runs/:id/apply {paths?, force?}` (owner) copies the chosen changes back. Conflicts are
   skipped unless forced; protected paths (`.git`, `.claude`, `.claudestra`, `node_modules`… in any case), links,
   folders and anything outside the project are never written. Before the first write, every file it will overwrite
   or delete is copied to `data/snapshots/<projectId>/<runId>/` and the manifest is written, so an apply that fails
   half-way can still be undone. `POST /api/runs/:id/undo-apply {force?}` restores it; files changed again after the
   apply are left alone unless forced. A workspace with more than 5000 files is refused rather than compared.
   Both append a `project.applied` event to the run (it may follow `run.completed`).

UI: **Projects** page (create/link, files, task history with applied/undone marks, "New task in this project"),
a project selector in the composer, a project chip and a **Changes** button in the run bar (checkbox per file,
line diff, Apply / Undo).
