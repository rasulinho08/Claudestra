# 7. UI spec

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Top bar: project ▾  | run status | $cost / budget | pause ▐▐ | stop ■ │
├───────────┬───────────────────────────────────────────┬──────────────┤
│ Left rail │              CANVAS (React Flow)           │  Inspector   │
│ Runs      │                                            │  (selected   │
│ Workflows │   [CEO]──▶[Researcher]──▶[BA]──▶[Coder]    │   node/edge) │
│ Agents    │                              ╲──▶[Reviewer]│  Tabs:       │
│ Skills    │                                            │  Live │ Tools│
│ Apps      │                                            │  Files│ Cost │
├───────────┴───────────────────────────────────────────┴──────────────┤
│ Prompt box  ▸ "Build me ..."        [Dynamic ▾ | Workflow ▾]   Send ▸ │
└──────────────────────────────────────────────────────────────────────┘
```

## Canvas
- **Nodes** = steps. Show: agent icon/color, name, one-line task, status badge, elapsed time, running cost,
  mini "activity" line (last tool, e.g. `🔧 github.search_code`).
- **Status styling:** pending (dim, dashed), ready (outlined), running (pulsing + animated ring), waiting approval
  (amber), needs input (blue), succeeded (solid + check), failed (red), skipped/cancelled (grey).
- **Edges** = dependencies. On `step.handoff`, a dot travels along the edge; hover shows the summary passed.
- **CEO node** pinned left/top; flashes when planning/reviewing; re-plans animate new nodes in and fade removed ones.
- **Loops** (coder ⇄ reviewer) drawn as a curved back-edge with an iteration counter.
- **Inactive agents** are not drawn (the plan only contains chosen agents); a "roster" strip lists unused ones, greyed,
  so you can see what the CEO *skipped*.
- Auto-layout (dagre/elk) left→right; manual drag allowed and remembered per workflow.
- Mini-map and fit-view; follow-active toggle (camera follows the running node).

## Inspector (selected node)
- **Live:** streaming messages and thinking, like a chat transcript for that agent.
- **Tools:** timeline of tool calls (name, input, result, duration); MCP calls tagged with the app icon.
- **Files:** changed files with diff viewer; artifacts list.
- **Cost:** tokens in/out/cache, $; model.
- **Config snapshot:** exact prompt, skills, tools used for this step (for debugging).
- Actions: re-run step, edit instruction, open in terminal (workspace path).

Selecting an **edge** shows the handoff payload.

## Approval mode switch
A segmented control next to the prompt box: **Manual · Smart · Auto**. Auto shows a persistent amber "Auto-approve ON" chip
in the top bar, and a one-click switch back to Smart mid-run.

## Approvals
A banner + node highlight when `*_approval_requested`. Modal shows the exact action (command, file path, diff,
MCP call with parameters), with **Approve once / Approve for this run / Reject (with note)**.

## Replay
Timeline scrubber at the bottom of the canvas; play/pause, 1×/4×/16×; click a marker to jump (plan created,
step failed, approval). Reading is identical to live mode.

## Library screens
- **Agents:** list/editor (prompt, model class, tools, skills, integrations, limits, color/icon); "test agent" box.
- **Skills:** list, import folder, view/edit `SKILL.md`, usage map.
- **Apps (Integrations):** catalog + custom MCP; connect, test, see discovered tools, set read/write per agent.
- **Workflows:** list, view as graph, edit JSON/form, run with parameters, "save from run".
- **Runs:** history table (prompt, status, cost, duration, agents used), filter, open/replay.

## Design principles
- Calm, dense, dark-first; color = agent identity, brightness = activity.
- Everything clickable leads to the raw data (no black boxes).
- UI never blocks on the backend: optimistic local state is forbidden; state comes from events only.
- Keyboard: `Space` pause, `F` follow-active, `/` focus prompt, `A`/`R` approve/reject.

## Responsive
Desktop first. Tablet: inspector becomes a bottom sheet. Mobile: read-only run viewer (list view of steps).
