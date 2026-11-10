---
name: sprint-dashboard
description: Use when asked for a sprint dashboard or sprint report page: fills the team's Power BI-style HTML template (KPIs, charts per project, person and work type, task table) with the sprint's tasks.
---
# Sprint dashboard (HTML)

The team's sprint dashboards always use `template.html` in this skill folder (read it with Read: `.claude/skills/sprint-dashboard/template.html`). Do not redesign it: same tiles, colours, charts and Azerbaijani labels.

## Steps
1. Collect the sprint's tasks. If you have the ClickUp tools, read them yourself: `mcp__clickup__get_workspace` to find the sprint's lists (one per project folder), then `mcp__clickup__list_tasks` for each list. Otherwise use what the user gave you (ClickUp export, a list, an earlier dashboard). For each task you need: project (GRC / General / AI Proxy), title, assignees, points (xal), work type, status. Ask for anything missing instead of guessing points or people.
2. Copy `template.html` to `dashboards/sprint-<number or dates>.html` in the workspace.
3. Replace only the block between `// ===== DATA` and `// ===== END DATA =====`:
   - `P`: one entry per person `{id:'NG', n:'Full Name', c:'--c1'}`; ids are initials; colours `--c1`…`--c7` in order.
   - `PR`: the projects in this sprint (keep keys GRC / GEN / AI unless the user names others).
   - `T`: one entry per task `{p:'GRC', t:'Task title', a:['NG'], x:3, k:'Work type'}`; `a` lists every assignee.
4. Replace the placeholders `{{COMPANY}}`, `{{SPRINT}}` ("Sprint 2", "Cari sprint"), `{{DATES}}` ("26 oktyabr – 1 noyabr 2026"), `{{PROJECTS}}` and the footnote.
5. Check before you finish: the total points in the KPI equals the sum of `x`; every assignee id exists in `P`; no task is listed twice.

## Rules
- A shared task's points are split equally between its assignees (the template does this); in task counts a shared task counts once per person. Say so in the footnote.
- Work types (`k`) are short Azerbaijani groups: Araşdırma, İnkişaf, Texniki analiz, Təqdimat, Kontent və brend, Görüş və əlaqələr, Onboarding, Proses…; reuse the same names across sprints.
- Status: the template shows all tasks as done. If some tasks are not done, say it in the footnote and in your report; do not mark them done silently.
- The page loads Chart.js from cdnjs; it needs internet to show the charts.
- Never put the dashboard anywhere (Drive, ClickUp, chat) yourself: write the file and tell the user where it is.
