# 20. Automations

Work that starts on its own, on a schedule. Each automation is a preset: a workflow template plus a schedule trigger
(docs/04), created with one switch on the **Automations** page. Nothing here bypasses approvals: reading and writing
files is automatic, anything that leaves the building (publishing, creating ClickUp tasks) waits for a person.

`apps/server/src/automations.ts` (`PRESETS`, `Automations`, `contextParams`), `GET/POST/DELETE /api/automations/:id`,
`POST /api/automations/:id/run`, `apps/web/src/pages/AutomationsPage.tsx`.

| Preset | Default schedule | Agent | What it produces |
|---|---|---|---|
| Morning briefing | Mon–Fri 08:30 | Project Manager | `brief/<date>.md`: yesterday, today, attention |
| Weekly sprint report | Friday 17:00 | Project Manager | sprint dashboard HTML and a summary from ClickUp (needs `CLICKUP_TOKEN`) |
| Market and competitor watch | every day 09:00 | Researcher | `watch/<date>.md`: dated, sourced news; says when nothing is new |
| Weekly social media | Monday 10:00 | Community Manager, Content Maker | posts and image cards; publishing waits for approval (docs/16) |

How it works:
- Turning a preset on creates the workflow from `templates/<id>.json` (once) and a schedule trigger marked with
  `__automation: <id>`. Changing the time or a field updates that trigger; turning it off disables it.
- The page offers a time and days; they are stored as a cron line in the server's local time. Claudestra must be
  running at that minute (a missed time is not caught up).
- Every workflow may use `{{today}}` and `{{recent_work}}` (tasks of the last 24 hours with status and cost, and the
  number of approvals waiting). They are filled in when the run starts (`contextParams`).
- A field without a default (what the social posts are about) must be filled before the automation can be on.
- With the Telegram bot on (docs/18), the final answer of every scheduled run is sent to the allowed chats.
- Runs use the `balanced` profile and `smart` approvals, and count towards the daily, monthly and per-agent budgets.

Adding one: put a template in `templates/`, add an entry to `PRESETS`, and titles in `apps/web/src/i18n.ts`
(`auto.<id>.title`, `auto.<id>.desc`, `auto.field.<param>`).
