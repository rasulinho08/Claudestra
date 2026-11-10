# 17. Missions, the office floor and voice

Three ideas adopted from the open-source project Munder Difflin (an "office of agents" desktop app, MIT): one boss
agent you brief, work that continues while you are away, and the team shown as people in an office. Claudestra
implements them its own way (web app, Agent SDK sessions, events); no code or art was copied. The pixel art here is
drawn with rectangles in `apps/web/src/office/art.ts`.

## Missions: one prompt, days of background work
`apps/server/src/missions.ts`, API `/api/missions`, page **Missions**, and the command centre on the **Office** page.

A mission = a goal + how long (`days`) + how often to work (`intervalMinutes`) + who (whole team or one agent) +
approval mode + optional total budget. It is a chain of ordinary runs called work sessions:

1. The heartbeat (`MissionRunner.tick`, every 20 s) starts a session when one is due and none is running.
2. The session's workspace is a copy of the last successful session's files (`seedFrom`), so work accumulates.
3. Every session gets the same brief (`tickBrief`): read `mission/board.md` (Todo / Doing / Done / Blocked: needs
   owner) and `mission/journal.md`, do the next 1–3 tasks, update both. The first session creates them.
4. When the run ends, cost is added and the next session is scheduled after the interval.

A mission ends when the board's first line is `MISSION STATUS: DONE` (`done`), at its deadline or total budget
(`stopped`), or after 3 failed sessions in a row (`failed`, resumable). A failed session's files are not carried
forward. If a session cannot start (usage limit, daily budget, AI not connected) the mission stays active and tries
again within 30 minutes: limits delay a mission, they do not break it. State lives in SQLite and in the files, so a
server restart continues where it stopped. The server must be running; nothing runs while the PC is off or asleep.

Approvals work as in any run: the session waits, the mission shows "needs you" (Office, Missions, HQ). Use `smart`
mode so only risky actions wait. `auto` is owner-only and still never skips sandbox, budgets or the never-auto list.
A **note to the team** can be changed any time; it is read at the start of every session.

Actions: pause, resume, work now, stop (cancels the session in flight), delete. People see their own missions; the
owner sees all.

## Office floor
`apps/web/src/office/` (`floor.ts` logic, `art.ts` pixel art, `OfficeFloor.tsx` canvas) and `pages/OfficePage.tsx`.
State comes from `GET /api/hq` (polled): each agent's active step and its latest tool call.

| The agent is… | On the floor |
|---|---|
| idle | at its desk; sometimes a coffee break |
| Write / Edit / an app (MCP) | typing at its desk, screen lit |
| Read / Glob / Grep / Skill | at the bookshelf |
| WebSearch / WebFetch | at the web terminal |
| Bash | at the server rack |
| waiting for approval | at the CEO's office, yellow bubble |
| CEO planning | at the task board |

Envelopes fly from the CEO to a desk when work is handed out and back when it is done. Click a person: their run if
busy, otherwise a chat with them. The cards under the floor repeat every status as text (screen readers, phones).
With "reduce motion" on, people jump to their place and nothing flies.

## Voice
`apps/web/src/Mic.tsx`: a microphone button in the Office command centre, Chat, Runs and Missions. It uses the
browser's speech recognition (Chrome, Edge; Azerbaijani `az-AZ` or English by UI language). The audio is handled by
the browser's speech service, not by Claudestra. Browsers without it do not show the button.
