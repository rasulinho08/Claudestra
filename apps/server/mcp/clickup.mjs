// Built-in "clickup" MCP server (docs/19): lets project-manager agents read the team's ClickUp (spaces, folders,
// lists, tasks with their sprint points) so sprint dashboards come from real data, and create tasks or comments after
// a person approves. Uses a personal API token (CLICKUP_TOKEN, "pk_..."), because ClickUp's own hosted MCP server
// only supports OAuth. There is deliberately no tool that changes or reassigns existing tasks.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.CLICKUP_URL || "https://api.clickup.com/api/v2").replace(/\/$/, "");
const TOKEN = process.env.CLICKUP_TOKEN ?? "";
const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "an id from a previous result");

async function clickup(path, init = {}) {
  if (!TOKEN) throw new Error("CLICKUP_TOKEN is not set in .env (ClickUp → Settings → Apps → API Token)");
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: TOKEN, "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  const raw = await res.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { err: raw.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${body?.err ?? JSON.stringify(body).slice(0, 200)}`);
  return body;
}

const guard = (fn) => async (args) => {
  try {
    return text(await fn(args));
  } catch (err) {
    return text(String(err instanceof Error ? err.message : err), true);
  }
};

const day = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : "");
const taskLine = (t) =>
  [
    `- [${t.status?.status ?? "?"}] ${t.name}`,
    `id ${t.id}`,
    t.points !== null && t.points !== undefined ? `${t.points} pts` : "no points",
    (t.assignees ?? []).length ? `assignees: ${t.assignees.map((a) => a.username ?? a.email ?? a.id).join(", ")}` : "unassigned",
    t.due_date ? `due ${day(t.due_date)}` : "",
    t.date_closed ? `closed ${day(t.date_closed)}` : "",
    (t.tags ?? []).length ? `tags: ${t.tags.map((x) => x.name).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

const server = new McpServer({ name: "claudestra-clickup", version: "1.0.0" });

server.tool(
  "get_workspace",
  "The ClickUp structure: workspaces, spaces, folders (for example the sprint folders) and lists, with their ids. Start here to find the list of a sprint. Read-only.",
  {},
  guard(async () => {
    const out = [];
    const { teams = [] } = await clickup("/team");
    for (const team of teams) {
      out.push(`Workspace: ${team.name} (id ${team.id})`);
      const { spaces = [] } = await clickup(`/team/${team.id}/space?archived=false`);
      for (const space of spaces) {
        out.push(`  Space: ${space.name} (id ${space.id})`);
        const { folders = [] } = await clickup(`/space/${space.id}/folder?archived=false`);
        for (const folder of folders) {
          out.push(`    Folder: ${folder.name} (id ${folder.id})`);
          for (const list of folder.lists ?? []) out.push(`      List: ${list.name} (id ${list.id}${list.task_count !== undefined ? `, ${list.task_count} tasks` : ""})`);
        }
        const { lists = [] } = await clickup(`/space/${space.id}/list?archived=false`);
        for (const list of lists) out.push(`    List: ${list.name} (id ${list.id})`);
      }
    }
    return out.length ? out.join("\n").slice(0, 18_000) : "No workspaces are visible to this token.";
  }),
);

server.tool(
  "list_tasks",
  "Tasks of one ClickUp list (for example a sprint): name, status, sprint points, assignees, dates, tags, plus totals of points by status and by assignee. Read-only.",
  { list_id: id.describe("List id from get_workspace"), include_closed: z.boolean().optional().describe("Also return done/closed tasks (default true)") },
  guard(async ({ list_id, include_closed }) => {
    const tasks = [];
    for (let page = 0; page < 10; page++) {
      const body = await clickup(`/list/${list_id}/task?page=${page}&subtasks=true&include_closed=${include_closed === false ? "false" : "true"}`);
      tasks.push(...(body.tasks ?? []));
      if (body.last_page !== false || (body.tasks ?? []).length === 0) break;
    }
    if (tasks.length === 0) return "This list has no tasks.";
    const byStatus = new Map();
    const byPerson = new Map();
    let total = 0;
    for (const t of tasks) {
      const pts = Number(t.points) || 0;
      total += pts;
      const st = t.status?.status ?? "?";
      byStatus.set(st, (byStatus.get(st) ?? 0) + pts);
      const people = (t.assignees ?? []).map((a) => a.username ?? a.email ?? String(a.id));
      // A shared task's points are split equally between its assignees.
      for (const p of people.length ? people : ["unassigned"]) byPerson.set(p, (byPerson.get(p) ?? 0) + pts / Math.max(1, people.length));
    }
    const fmt = (m) => [...m.entries()].map(([k, v]) => `${k}: ${Number.isInteger(v) ? v : v.toFixed(1)}`).join(", ");
    return [`${tasks.length} tasks, ${total} points in total`, `Points by status: ${fmt(byStatus)}`, `Points by assignee: ${fmt(byPerson)}`, "", ...tasks.map(taskLine)].join("\n").slice(0, 18_000);
  }),
);

server.tool(
  "get_task",
  "One ClickUp task in full: description, status, points, assignees, dates, custom fields. Read-only.",
  { task_id: id.describe("Task id from list_tasks") },
  guard(async ({ task_id }) => {
    const t = await clickup(`/task/${task_id}`);
    const fields = (t.custom_fields ?? []).filter((f) => f.value !== undefined && f.value !== null).map((f) => `  ${f.name}: ${typeof f.value === "object" ? JSON.stringify(f.value).slice(0, 120) : f.value}`);
    return [taskLine(t), `List: ${t.list?.name ?? ""} · Folder: ${t.folder?.name ?? ""} · URL: ${t.url ?? ""}`, "", (t.text_content ?? t.description ?? "").slice(0, 6000), fields.length ? `\nCustom fields:\n${fields.join("\n")}` : ""].join("\n");
  }),
);

server.tool(
  "create_task",
  "Create a new task in a ClickUp list. Always needs a person's approval first. It cannot set or change assignees: the person assigns it in ClickUp.",
  {
    list_id: id.describe("List id from get_workspace"),
    name: z.string().min(1).max(300),
    description: z.string().max(8000).optional(),
    points: z.number().min(0).max(1000).optional().describe("Sprint points"),
    due_date: z.string().optional().describe("ISO date, e.g. 2026-11-20"),
  },
  guard(async ({ list_id, name, description, points, due_date }) => {
    const due = due_date ? Date.parse(due_date) : NaN;
    const t = await clickup(`/list/${list_id}/task`, {
      method: "POST",
      body: JSON.stringify({ name, ...(description ? { description } : {}), ...(points !== undefined ? { points } : {}), ...(Number.isFinite(due) ? { due_date: due } : {}) }),
    });
    return `Task created: ${t.name} (id ${t.id})\n${t.url ?? ""}`;
  }),
);

server.tool(
  "create_comment",
  "Add a comment to a ClickUp task. Always needs a person's approval first.",
  { task_id: id, comment: z.string().min(1).max(4000) },
  guard(async ({ task_id, comment }) => {
    await clickup(`/task/${task_id}/comment`, { method: "POST", body: JSON.stringify({ comment_text: comment, notify_all: false }) });
    return "Comment added.";
  }),
);

await server.connect(new StdioServerTransport());
