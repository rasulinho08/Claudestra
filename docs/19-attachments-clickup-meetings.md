# 19. Attachments, ClickUp and meetings

## Attachments
`apps/server/src/uploads.ts`, `POST /api/uploads` (multipart, field `files`), `uploadId` on `POST /api/runs` and on
chat messages; `apps/web/src/Attach.tsx` (the 📎 button in Office, Chat and Runs).

Files are uploaded first and kept in `data/uploads/<id>/` (git-ignored, removed after a day if unused). When the task
starts they are copied into the run's workspace under `inputs/` (`.claudestra/inputs/` for project runs, so they are
not offered as project changes) and the agents are told which files were attached. Limits: 10 files, 15 MB each,
40 MB together. File names are reduced to a safe base name; an upload can be used once, only by the person who
uploaded it.

What agents can read depends on the engine: text formats (md, txt, csv, json, html, code) everywhere; PDFs and
pictures with Claude. For other formats the agent says it cannot read the file instead of guessing.

## ClickUp
`apps/server/mcp/clickup.mjs`, integration `clickup` in `integrations.example.json`, secret `CLICKUP_TOKEN`
(ClickUp → avatar → Settings → Apps → API Token, starts with `pk_`). ClickUp's own hosted MCP server only supports
OAuth, so Claudestra ships a small server that uses the personal token.

| Tool | Does | Approval |
|---|---|---|
| `get_workspace` | workspaces, spaces, folders (sprint folders), lists with ids | no |
| `list_tasks` | a list's tasks with status, sprint points, assignees, dates; totals by status and person | no |
| `get_task` | one task in full | no |
| `create_task` | new task (name, description, points, due date) | always |
| `create_comment` | comment on a task | always |

There is no tool that edits, reassigns, moves or deletes tasks, and `create_task` cannot set assignees. The
Project Manager agent may use the read tools; give `clickup` to a person's PM agent to allow proposals to become
tasks after approval. The `sprint-dashboard` skill reads the sprint from ClickUp when the tools are available.

The token sees everything its ClickUp user sees. Use a token of a user limited to the spaces the agents need.

## Meetings on the office floor
While the CEO reviews or sums up a run, `GET /api/hq` marks the agents who already finished a step of that run
(`team[].meeting`). On the floor they walk to the meeting room and sit at the table, the CEO stands at the task board
("reviewing the work"), and they return to their desks when the run ends.
