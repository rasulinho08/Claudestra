// Built-in ClickUp MCP server (docs/19): reads sprints, writes only through approval-gated create_* tools.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { IntegrationRegistry } from "../src/integrations.ts";
import { openMcpBridge } from "../src/mcp-bridge.ts";
import { DEFAULT_NEVER_AUTO } from "../src/config.ts";
import { evaluate } from "../src/approvals.ts";
import { SERVER_ONLY_SECRETS } from "../src/secret-env.ts";

const example = fileURLToPath(new URL("../../../integrations.example.json", import.meta.url));

test("clickup needs its token and never reaches agents' shells", () => {
  const reg = new IntegrationRegistry(example, {});
  const cfg = reg.config("clickup");
  assert.deepEqual(cfg && "missing" in cfg ? cfg.missing : [], ["CLICKUP_TOKEN"]);
  assert.ok(SERVER_ONLY_SECRETS.includes("CLICKUP_TOKEN"));
});

test("clickup reads the workspace and a sprint's tasks, and creates a task", async () => {
  const seen: { method: string; url: string; auth: string; body: string }[] = [];
  const task = (id: string, name: string, status: string, points: number | null, who: string[]) => ({ id, name, status: { status }, points, assignees: who.map((u) => ({ username: u })), tags: [] });
  const fake = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization), body });
      res.setHeader("content-type", "application/json");
      const url = req.url!;
      if (url === "/team") return res.end(JSON.stringify({ teams: [{ id: "t1", name: "Acme" }] }));
      if (url.startsWith("/team/t1/space")) return res.end(JSON.stringify({ spaces: [{ id: "s1", name: "Work" }] }));
      if (url.startsWith("/space/s1/folder")) return res.end(JSON.stringify({ folders: [{ id: "f1", name: "GRC Sprint Folder", lists: [{ id: "l1", name: "Sprint 2", task_count: 3 }] }] }));
      if (url.startsWith("/space/s1/list")) return res.end(JSON.stringify({ lists: [] }));
      if (url.startsWith("/list/l1/task") && req.method === "GET")
        return res.end(JSON.stringify({ last_page: true, tasks: [task("a1", "Research", "done", 5, ["aysel"]), task("a2", "Build", "in progress", 3, ["elvin", "aysel"]), task("a3", "Plan", "to do", null, [])] }));
      if (url === "/list/l1/task" && req.method === "POST") return res.end(JSON.stringify({ id: "new1", name: JSON.parse(body).name, url: "https://app.clickup.example/t/new1" }));
      res.statusCode = 404;
      res.end(JSON.stringify({ err: "not found" }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const port = (fake.address() as { port: number }).port;
  const reg = new IntegrationRegistry(example, { CLICKUP_TOKEN: "pk_test", CLICKUP_URL: `http://127.0.0.1:${port}` });
  const { servers, allows } = reg.forAgent(["clickup"], { CLAUDESTRA_WORKSPACE: "/tmp" });
  const bridge = await openMcpBridge(servers, allows);
  const signal = new AbortController().signal;
  try {
    assert.deepEqual(bridge.errors, []);
    const names = bridge.declarations.map((d) => d.name).sort();
    assert.deepEqual(names, ["mcp__clickup__create_comment", "mcp__clickup__create_task", "mcp__clickup__get_task", "mcp__clickup__get_workspace", "mcp__clickup__list_tasks"]);
    assert.ok(!names.some((n) => /update|assign|delete/.test(n)), "no tool can change or reassign tasks");
    const ws = await bridge.call("mcp__clickup__get_workspace", {}, signal);
    assert.match(ws.output, /Folder: GRC Sprint Folder[\s\S]*List: Sprint 2 \(id l1, 3 tasks\)/);
    const tasks = await bridge.call("mcp__clickup__list_tasks", { list_id: "l1" }, signal);
    assert.match(tasks.output, /3 tasks, 8 points in total/);
    assert.match(tasks.output, /Points by assignee: aysel: 6\.5, elvin: 1\.5, unassigned: 0/);
    assert.match(tasks.output, /\[done\] Research · id a1 · 5 pts/);
    const bad = await bridge.call("mcp__clickup__list_tasks", { list_id: "../team" }, signal);
    assert.equal(bad.ok, false);
    const made = await bridge.call("mcp__clickup__create_task", { list_id: "l1", name: "Write report", points: 2 }, signal);
    assert.match(made.output, /Task created: Write report \(id new1\)/);
    const post = seen.find((s) => s.method === "POST")!;
    assert.deepEqual(JSON.parse(post.body), { name: "Write report", points: 2 }, "no assignees are sent");
    assert.ok(seen.every((s) => s.auth === "pk_test"));
  } finally {
    await bridge.close();
    fake.close();
  }
});

test("creating ClickUp tasks and comments always waits for a person", () => {
  for (const tool of ["mcp__clickup__create_task", "mcp__clickup__create_comment"]) {
    const gate = evaluate({ mode: "auto", workspace: "/tmp", agentName: "pm", agentTools: [], mcpAllowed: () => true, requiresApproval: [], neverAuto: DEFAULT_NEVER_AUTO, approvedForRun: new Set([tool]) }, tool, {});
    assert.equal(gate.kind, "ask", tool);
  }
  const read = evaluate({ mode: "smart", workspace: "/tmp", agentName: "pm", agentTools: [], mcpAllowed: () => true, requiresApproval: [], neverAuto: DEFAULT_NEVER_AUTO, approvedForRun: new Set() }, "mcp__clickup__list_tasks", {});
  assert.equal(read.kind, "allow");
});
