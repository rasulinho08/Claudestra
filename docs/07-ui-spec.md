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

## Results (what a run produced)
Every run writes into its own folder, `workspaces/<runId>/` (git-ignored); the Files tab lists it and `.md` files are
shown formatted (toggle **Source**). The final answer and finished agent messages render as Markdown
(`apps/web/src/markdown.ts`: a small parser that builds React elements, never injects HTML; links only http(s)/mailto).

The **Results bar** sits above the answer and the file list once the run has files:
- **▶ Try it**: opens the run's `index.html` (or the shallowest HTML file) in a preview window. Pages are served
  read-only by a second server on `PREVIEW_PORT` (default `PORT+1`, `0` = off; `PREVIEW_URL` when deployed behind a
  proxy) at `/<runId>/<token>/…`, where the token comes from `GET /api/runs/:id/preview` (HMAC, new on every server
  start). The app opens it under the other loopback name (127.0.0.1 ↔ localhost), so the page is a different site:
  its own `localStorage` and cookies, no access to the API's cookies, no reads of the API, and its writes are refused
  by the Origin check below. Files are resolved with `realpath`, so links/junctions cannot leave the workspace.
- **📁 Open folder**: opens the folder in Explorer/Finder; only when the server and the browser are on the same computer.
- **⬇ ZIP**: all files except `.claudestra/` notes (`GET /api/runs/:id/zip`, 100 MB cap).
- **⬆ GitHub**: `POST /api/runs/:id/github {repo, private}` with `GITHUB_TOKEN` through the REST API (no git needed,
  works with every engine). A missing repo is created (private by default); an existing one gets one commit that adds
  or updates files, nothing is deleted. Pushes are remembered per run (`GET /api/runs/:id/exports`). Owner only.

API writes from a browser must come from the app's own origin or `WEB_ORIGINS` (default the Vite dev server); other
websites and the preview origin get 403. Requests without an `Origin` header (CLI, hooks) are unaffected. While the
server is bound to this computer, the `Host` header must be localhost/127.0.0.1/[::1] or in `ALLOWED_HOSTS` (blocks
DNS rebinding). Run ids must be one safe path segment; hook `session_id`s are restricted to letters, digits, `-`, `_`.
Agents never inherit server-only secrets (`GITHUB_TOKEN`, `AUTH_TOKEN`, `HOOKS_SECRET`…), and Claudestra's own Bash
tool also drops model API keys (`apps/server/src/secret-env.ts`).

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

## Stage (robot view)
An alternative to the canvas: the Strativu robot hops between agent desks, carries handoffs and reacts to
approvals and completion. Switch with Graph / Stage, pop out with ↗, or open `#/stage?run=live` on a second
monitor / as an OBS browser source. Details in [doc 13](13-stage-and-obs.md).

## Language
- The interface is available in English and Azerbaijani (`apps/web/src/i18n.ts`, plain dictionaries). The AZ/EN
  switch in the top bar is saved in the browser (`claudestra.lang`); the first visit follows the browser language.
- Built-in agents get translated display names (Proqramçı, Tədqiqatçı, Rəyçi…); custom agents keep the name from their file.
- The composer has an **answer language** select (auto, az, en, ru, tr). It is sent as `language` in `POST /api/runs`
  and recorded in `run.started`; the orchestrator adds a rule to every prompt (code and file names stay English).
  `auto` answers in the language of the request.

## Design principles
- Calm, dense, dark-first; color = agent identity, brightness = activity.
- Everything clickable leads to the raw data (no black boxes).
- UI never blocks on the backend: optimistic local state is forbidden; state comes from events only.
- Keyboard: `Space` pause, `F` follow-active, `/` focus prompt, `A`/`R` approve/reject.

## Responsive
Desktop first. Tablet: inspector becomes a bottom sheet. Mobile: read-only run viewer (list view of steps).
