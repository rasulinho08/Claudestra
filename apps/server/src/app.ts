import path from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { z } from "zod";
import { ApprovalDecision, CreateRunRequest, Role, type ClaudestraEvent, type HealthResponse, type SessionInfo } from "@claudestra/protocol";
import type { Config } from "./config.ts";
import { resolveSdkAuth } from "./auth.ts";
import type { RunStore } from "./store.ts";
import type { AgentRegistry } from "./agents.ts";
import type { StartOptions } from "./orchestrator.ts";
import { HookEventMapper, type HookPayload } from "./hook-mapper.ts";
import type { SkillLibrary } from "./skills.ts";
import type { IntegrationRegistry } from "./integrations.ts";
import { WorkflowInput, WorkflowStore } from "./workflows.ts";
import { analytics } from "./analytics.ts";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { exportFiles, listFiles, readWorkspaceFile } from "./files.ts";
import { createZip } from "./zip.ts";
import { GitHubError, exportToGitHub, repoSlug } from "./github-export.ts";
import { SkillImportError, importSkill } from "./skill-import.ts";
import type { PreviewTokens } from "./preview.ts";
import { ProjectError, Projects } from "./projects.ts";
import { startOfDay, startOfMonth } from "./analytics.ts";
import { HttpError, RunLauncher } from "./runs.ts";
import { Memory } from "./memory.ts";
import { Access, allows, requiredRole, safeEqual, tokenFrom } from "./access.ts";
import { TriggerInput, TriggerStore, paramsFromPayload, runTrigger, verifyWebhook, type Fire } from "./triggers.ts";
import { Evals } from "./evals.ts";

export type RunStarter = {
  start(runId: string, opts: StartOptions): Promise<void>;
  cancel(runId: string): boolean;
  pause(runId: string): boolean;
  resume(runId: string): boolean;
  decide(runId: string, approvalId: string, decision: "approve" | "approve_run" | "reject", note: string): boolean;
};

export type Services = {
  config: Config;
  store: RunStore;
  agents: AgentRegistry;
  runner: RunStarter;
  skills: SkillLibrary;
  integrations: IntegrationRegistry;
  workflows: WorkflowStore;
  memory?: Memory;
  access?: Access;
  triggers?: TriggerStore;
  evals?: Evals;
  launcher?: RunLauncher;
  templatesDir?: string;
  hooksSecret?: string | null;
  // Whether the "Try it" preview server is listening (index.ts); tests leave it off.
  previewRunning?: () => boolean;
  previewTokens?: PreviewTokens;
  projects?: Projects;
  // Opens a folder in the OS file manager; replaceable in tests.
  openFolder?: (dir: string) => void;
};

// Explorer / Finder / the desktop's file manager. Fire and forget: explorer.exe exits with 1 even on success.
export function openInFileManager(dir: string) {
  const [cmd, args] = process.platform === "win32" ? ["explorer.exe", [dir]] : process.platform === "darwin" ? ["open", [dir]] : ["xdg-open", [dir]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => {});
  child.unref();
}

// A run id names a folder under workspaces/: one safe path segment, never "..", slashes or a drive letter.
export const safeRunId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id) && !id.includes("..");

// DNS-rebinding guard for a server bound to this computer: the browser must address it as localhost/127.0.0.1/[::1]
// (or a name in ALLOWED_HOSTS), so a hostile site that re-points its domain to 127.0.0.1 cannot use the API.
export function hostAllowed(host: string | undefined, bindHost: string, extra: string[] = []): boolean {
  if (!["127.0.0.1", "localhost", "::1"].includes(bindHost)) return true;
  if (!host) return true;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return ["localhost", "127.0.0.1", "::1"].includes(name) || extra.map((h) => h.toLowerCase()).includes(name);
}

// CSRF guard: a write from a browser must come from the app itself (same host) or a configured dev origin.
// Blocks other websites and the "Try it" preview origin from driving the API. Requests without Origin (curl, CLI) pass.
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const u = new URL(origin);
    if (host && u.host === host) return true;
    return allowed.some((a) => a.replace(/\/+$/, "") === u.origin);
  } catch {
    return false;
  }
}

type Env = { Variables: { user: SessionInfo["user"] } };

const HEARTBEAT_MS = 15_000;
const COOKIE_DAYS = 30;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const issues = (err: z.ZodError) => err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ");

async function body(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

function fail(c: Context, err: unknown) {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  return c.json({ error: message(err) }, 400);
}

const isLoopback = (addr: string | undefined) => !addr || addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

function remoteAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined; // app.request() in tests has no socket
  }
}

export function createApp(s: Services) {
  const { config, store, agents, runner, skills, integrations, workflows } = s;
  const memory = s.memory ?? new Memory(store);
  const access = s.access ?? new Access(store, null);
  const triggers = s.triggers ?? new TriggerStore(store);
  const loopbackServer = ["127.0.0.1", "localhost", "::1"].includes(config.host);
  const projects = s.projects ?? new Projects(store, config.projectsDir, config.snapshotsDir, config.workspacesDir, loopbackServer);
  const launcher = s.launcher ?? new RunLauncher(config, store, agents, workflows, runner, projects);
  const evals = s.evals ?? new Evals(path.join(config.agentsDir, "../evals"), store, launcher, config.workspacesDir);
  const templatesDir = s.templatesDir ?? path.join(config.agentsDir, "../templates");
  const app = new Hono<Env>();
  const observers = new Map<string, HookEventMapper>();

  // ---- access control ------------------------------------------------------------------------
  // Public: health, session, login/logout, webhook triggers (own secret). Observer hooks: loopback or HOOKS_SECRET.
  const PUBLIC = [/^\/api\/health$/, /^\/api\/session$/, /^\/api\/login$/, /^\/api\/logout$/, /^\/api\/triggers\/[^/]+\/fire$/];

  app.use("*", async (c, next) => {
    if (!hostAllowed(c.req.header("host"), config.host, config.allowedHosts)) return c.json({ error: "unexpected Host header (add it to ALLOWED_HOSTS if you use a custom name)" }, 403);
    return next();
  });

  // Hooks come from the Claude Code CLI (no Origin); a browser posting here must be the app itself.
  app.use("/hooks/*", async (c, next) => {
    if (!originAllowed(c.req.header("origin"), c.req.header("x-forwarded-host") ?? c.req.header("host"), config.webOrigins)) return c.json({ error: "cross-origin request refused" }, 403);
    return next();
  });

  app.use("/api/runs/:id/*", async (c, next) => {
    if (!safeRunId(c.req.param("id"))) return c.json({ error: "run not found" }, 404);
    return next();
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !/^\/api\/triggers\/[^/]+\/fire$/.test(c.req.path)) {
      if (!originAllowed(c.req.header("origin"), c.req.header("x-forwarded-host") ?? c.req.header("host"), config.webOrigins))
        return c.json({ error: "cross-origin request refused (add the page's origin to WEB_ORIGINS if this is your own UI)" }, 403);
    }
    const user = access.enabled ? access.identify(tokenFrom(c.req.header("authorization"), c.req.header("cookie"), c.req.query("token"))) : { name: "local", role: "owner" as const };
    c.set("user", user);
    if (!access.enabled || PUBLIC.some((re) => re.test(c.req.path))) return next();
    if (!user) return c.json({ error: "login required" }, 401);
    if (!allows(user.role, requiredRole(c.req.method, c.req.path))) return c.json({ error: `the ${user.role} role cannot do this` }, 403);
    return next();
  });

  app.get("/api/session", (c) => c.json({ authEnabled: access.enabled, user: c.get("user") } satisfies SessionInfo));

  app.post("/api/login", async (c) => {
    const parsed = z.object({ token: z.string().min(1).max(500) }).safeParse(await body(c));
    const user = parsed.success ? access.identify(parsed.data.token) : null;
    if (!parsed.success || !user) return c.json({ error: "invalid token" }, 401);
    const secure = c.req.url.startsWith("https:") ? "; Secure" : "";
    c.header("Set-Cookie", `claudestra_token=${encodeURIComponent(parsed.data.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}${secure}`);
    return c.json({ user });
  });

  app.post("/api/logout", (c) => {
    c.header("Set-Cookie", "claudestra_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return c.json({ ok: true });
  });

  app.get("/api/users", (c) => c.json(access.users()));
  app.post("/api/users", async (c) => {
    const parsed = z.object({ name: z.string(), role: Role }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    if (!access.enabled && parsed.data.role !== "owner") return c.json({ error: "the first user must be an owner (it turns login on)" }, 400);
    try {
      return c.json(access.addUser(parsed.data.name, parsed.data.role), 201);
    } catch (err) {
      return fail(c, err);
    }
  });
  app.delete("/api/users/:id", (c) => c.json({ ok: access.removeUser(c.req.param("id")) }));

  app.get("/api/health", (c) => {
    const auth = resolveSdkAuth(config.authMode, process.env);
    const res: HealthResponse = {
      ok: true,
      authMode: config.authMode,
      canStartRuns: auth.ok,
      models: config.profiles[config.defaultProfile].models,
      profiles: config.profiles,
      defaultProfile: config.defaultProfile,
      defaultApprovalMode: config.defaultApprovalMode,
      agents: agents.infos(),
      warning: auth.ok ? auth.warning : auth.reason,
      results: {
        previewPort: config.previewPort && (s.previewRunning?.() ?? false) ? config.previewPort : null,
        previewUrl: config.previewUrl,
        openFolder: isLoopback(remoteAddress(c)) && ["127.0.0.1", "localhost", "::1"].includes(config.host),
        github: Boolean(config.githubToken),
      },
    };
    return c.json(res);
  });

  // ---- runs -------------------------------------------------------------------------------

  app.get("/api/runs", (c) => c.json(store.list()));

  app.post("/api/runs", async (c) => {
    const parsed = CreateRunRequest.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    try {
      const { runId } = launcher.start({ ...parsed.data, createdBy: c.get("user")?.name, origin: "user" });
      return c.json({ runId }, 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  for (const action of ["cancel", "pause", "resume"] as const) {
    app.post(`/api/runs/:id/${action}`, (c) => {
      const id = c.req.param("id");
      if (!store.has(id)) return c.json({ error: "run not found" }, 404);
      return c.json({ ok: runner[action](id) });
    });
  }

  app.post("/api/runs/:id/approvals/:approvalId", async (c) => {
    const parsed = ApprovalDecision.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "decision must be approve, approve_run or reject" }, 400);
    const ok = runner.decide(c.req.param("id"), c.req.param("approvalId"), parsed.data.decision, parsed.data.note);
    return ok ? c.json({ ok }) : c.json({ error: "no pending approval with that id" }, 404);
  });

  // SSE: replays stored events after Last-Event-ID (or ?after=), then streams live ones.
  app.get("/api/runs/:id/events", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    const after = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? 0) || 0;

    return streamSSE(c, async (stream) => {
      const queue: ClaudestraEvent[] = store.events(id, after);
      let wake: (() => void) | null = null;
      const unsubscribe = store.subscribe(id, (event) => {
        queue.push(event);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });

      let last = after;
      try {
        while (!closed) {
          while (queue.length > 0) {
            const event = queue.shift()!;
            if (event.seq <= last) continue;
            await stream.writeSSE({ id: String(event.seq), event: "event", data: JSON.stringify(event) });
            last = event.seq;
          }
          const timedOut = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), HEARTBEAT_MS);
            timer.unref?.();
            wake = () => {
              clearTimeout(timer);
              resolve(false);
            };
          });
          wake = null;
          if (timedOut && !closed) await stream.writeSSE({ event: "ping", data: "" });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.get("/api/runs/:id/files", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    return c.json(listFiles(runDir(id)));
  });

  // ---- results: ZIP, open folder, GitHub (docs/07 "Results") ---------------------------------

  store.database.exec("CREATE TABLE IF NOT EXISTS run_exports (run_id TEXT NOT NULL, repo TEXT NOT NULL, url TEXT NOT NULL, commit_sha TEXT NOT NULL, at TEXT NOT NULL)");
  function runDir(id: string): string {
    const dir = path.resolve(config.workspacesDir, id);
    if (!safeRunId(id) || path.dirname(dir) !== path.resolve(config.workspacesDir)) throw new HttpError(404, "run not found");
    return dir;
  }

  app.get("/api/runs/:id/zip", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    try {
      const files = exportFiles(runDir(id), c.req.query("internal") === "1");
      if (files.length === 0) return c.json({ error: "the run's workspace has no files" }, 404);
      const zip = createZip(files);
      const name = `${repoSlug(store.summary(id)?.prompt ?? "")}-${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8)}.zip`;
      return c.body(new Uint8Array(zip), 200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/runs/:id/open-folder", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    let dir: string;
    try {
      dir = runDir(id);
    } catch (err) {
      return fail(c, err);
    }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return c.json({ error: "this run has no workspace folder yet", path: dir }, 404);
    if (!isLoopback(remoteAddress(c)) || !["127.0.0.1", "localhost", "::1"].includes(config.host)) return c.json({ error: "only available when Claudestra runs on this computer", path: dir }, 403);
    try {
      (s.openFolder ?? openInFileManager)(dir);
      return c.json({ ok: true, path: dir });
    } catch (err) {
      return c.json({ error: message(err), path: dir }, 500);
    }
  });

  // Link for the "Try it" preview server (preview.ts); the token is per run and per server start.
  app.get("/api/runs/:id/preview", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    if (!s.previewTokens || !config.previewPort) return c.json({ error: "the preview server is off" }, 404);
    return c.json({ path: `/${id}/${s.previewTokens.tokenFor(id)}/` });
  });

  app.get("/api/runs/:id/exports", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    const rows = store.database.prepare("SELECT repo, url, commit_sha AS \"commit\", at FROM run_exports WHERE run_id = ? ORDER BY at DESC").all(id);
    return c.json(rows);
  });

  app.post("/api/runs/:id/github", async (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    if (!config.githubToken) return c.json({ error: "Set GITHUB_TOKEN in .env (a GitHub token with repo access) and restart." }, 400);
    const parsed = z.object({ repo: z.string().min(1).max(140), private: z.boolean().default(true), includeInternal: z.boolean().default(false) }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    const summary = store.summary(id);
    try {
      const result = await exportToGitHub({
        token: config.githubToken,
        apiUrl: config.githubApiUrl,
        repo: parsed.data.repo,
        private: parsed.data.private,
        files: exportFiles(runDir(id), parsed.data.includeInternal),
        message: `Claudestra run ${id.slice(0, 8)}: ${(summary?.prompt ?? "").replace(/\s+/g, " ").slice(0, 60)}`,
        description: `Made with Claudestra: ${(summary?.prompt ?? "").replace(/\s+/g, " ").slice(0, 200)}`,
      });
      store.database.prepare("INSERT INTO run_exports (run_id, repo, url, commit_sha, at) VALUES (?, ?, ?, ?, ?)").run(id, result.repo, result.url, result.commit, new Date().toISOString());
      return c.json(result);
    } catch (err) {
      if (err instanceof GitHubError) return c.json({ error: err.message }, err.status >= 500 ? 502 : err.status === 401 || err.status === 403 ? 400 : (err.status as 400));
      return fail(c, err);
    }
  });

  app.get("/api/runs/:id/file", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    try {
      return c.json(readWorkspaceFile(runDir(id), c.req.query("path") ?? ""));
    } catch (err) {
      return fail(c, err);
    }
  });

  // ---- projects (upgrade A3) ----------------------------------------------------------------

  const projectFail = (c: Context, err: unknown) => (err instanceof ProjectError ? c.json({ error: err.message }, err.status) : fail(c, err));

  app.get("/api/projects", (c) => c.json({ projects: projects.list(), canLinkFolders: loopbackServer }));

  app.post("/api/projects", async (c) => {
    const parsed = z.object({ name: z.string().min(1).max(80), folder: z.string().max(500).optional() }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    try {
      return c.json(projects.create(parsed.data.name, parsed.data.folder), 201);
    } catch (err) {
      return projectFail(c, err);
    }
  });

  app.get("/api/projects/:id", (c) => {
    const p = projects.get(c.req.param("id"));
    if (!p) return c.json({ error: "project not found" }, 404);
    try {
      return c.json({ ...p, exists: existsSync(p.path), files: projects.files(p.id), runs: projects.runs(p.id) });
    } catch (err) {
      return projectFail(c, err);
    }
  });

  app.delete("/api/projects/:id", (c) => {
    try {
      projects.remove(c.req.param("id"), c.req.query("deleteFiles") === "1");
      return c.json({ ok: true });
    } catch (err) {
      return projectFail(c, err);
    }
  });

  app.get("/api/runs/:id/changes", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    try {
      const p = projects.projectOf(id);
      const row = store.database.prepare("SELECT applied_at, undone_at FROM project_runs WHERE run_id = ?").get(id) as { applied_at: string | null; undone_at: string | null } | undefined;
      return c.json({ project: p ? { id: p.id, name: p.name, path: p.path } : null, appliedAt: row?.applied_at ?? null, undoneAt: row?.undone_at ?? null, changes: projects.changes(id) });
    } catch (err) {
      return projectFail(c, err);
    }
  });

  app.post("/api/runs/:id/apply", async (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    if (store.status(id) === "running") return c.json({ error: "wait until the run has finished" }, 409);
    const parsed = z.object({ paths: z.array(z.string()).max(5000).optional(), force: z.boolean().default(false) }).safeParse((await body(c)) ?? {});
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    try {
      const r = projects.apply(id, parsed.data);
      const p = projects.projectOf(id)!;
      store.append(id, { type: "project.applied", data: { projectId: p.id, applied: r.applied.length, skipped: r.skipped.length, undone: false } });
      return c.json(r);
    } catch (err) {
      return projectFail(c, err);
    }
  });

  app.post("/api/runs/:id/undo-apply", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    try {
      const r = projects.undo(id);
      const p = projects.projectOf(id)!;
      store.append(id, { type: "project.applied", data: { projectId: p.id, applied: r.restored, skipped: 0, undone: true } });
      return c.json(r);
    } catch (err) {
      return projectFail(c, err);
    }
  });

  // ---- HQ home page (upgrade V4): one call with what the owner needs to see first ------------

  app.get("/api/hq", (c) => {
    const running = store.list(200).filter((r) => r.status === "running");
    const activeSteps = running.length
      ? (store.database
          .prepare(`SELECT run_id, step_id, agent_id, task, status FROM steps WHERE status IN ('running', 'waiting_approval') AND run_id IN (${running.map(() => "?").join(",")})`)
          .all(...running.map((r) => r.id)) as { run_id: string; step_id: string; agent_id: string | null; task: string | null; status: string }[])
      : [];
    const approvals = (
      store.database
        .prepare("SELECT a.id, a.run_id, a.step_id, a.kind, a.request, a.created_at, r.prompt, s.agent_id FROM approvals a JOIN runs r ON r.id = a.run_id LEFT JOIN steps s ON s.run_id = a.run_id AND s.step_id = a.step_id WHERE a.decision IS NULL AND r.status = 'running' ORDER BY a.created_at")
        .all() as { id: string; run_id: string; step_id: string | null; kind: string; request: string; created_at: string; prompt: string; agent_id: string | null }[]
    ).map((a) => {
      let request: { tool?: string; input?: unknown; reason?: string } = {};
      try {
        request = JSON.parse(a.request);
      } catch {
        // keep empty
      }
      return { approvalId: a.id, runId: a.run_id, stepId: a.step_id, kind: a.kind, agentId: a.agent_id ?? (a.kind === "plan" ? "ceo" : null), prompt: a.prompt, tool: request.tool ?? null, input: request.input ?? null, reason: request.reason ?? "", createdAt: a.created_at };
    });
    const busy = new Map<string, { runId: string; task: string }>();
    for (const st of activeSteps) if (st.agent_id && !busy.has(st.agent_id)) busy.set(st.agent_id, { runId: st.run_id, task: st.task ?? "" });
    const wfName = (id: string) => workflows.get(id)?.name ?? id;
    const upcoming = triggers
      .list()
      .filter((t) => t.enabled && t.nextRunAt)
      .sort((a, b) => (a.nextRunAt! < b.nextRunAt! ? -1 : 1))
      .slice(0, 5)
      .map((t) => ({ id: t.id, name: t.name || wfName(t.workflowId), workflow: wfName(t.workflowId), nextRunAt: t.nextRunAt }));
    return c.json({
      authMode: config.authMode,
      running: running.map((r) => ({ ...r, active: activeSteps.filter((st) => st.run_id === r.id).map((st) => ({ stepId: st.step_id, agentId: st.agent_id, status: st.status })) })),
      approvals,
      recent: store.list(8),
      upcoming,
      spend: { today: store.spentSince(startOfDay()), month: store.spentSince(startOfMonth()), dailyCap: config.dailyBudgetUsd, monthlyCap: config.monthlyBudgetUsd },
      projects: projects.list().slice(0, 5),
      team: agents.all().map((a) => ({ ...a.info, skills: a.skills.length, busy: busy.get(a.info.id) ?? null })),
    });
  });

  // ---- agents, skills, integrations -------------------------------------------------------

  app.get("/api/agents", (c) =>
    c.json(agents.all().map((a) => ({ ...a.info, tools: a.tools, skills: a.skills, integrations: a.integrations, requiresApproval: a.requiresApproval, limits: a.limits, source: a.source }))),
  );

  app.put("/api/agents/:id", async (c) => {
    const parsed = z.object({ source: z.string().min(1).max(50_000) }).safeParse(await body(c));
    const id = c.req.param("id");
    if (!parsed.success || !/^[a-z][a-z0-9-]*$/.test(id)) return c.json({ error: "source is required" }, 400);
    try {
      return c.json(agents.save(id, parsed.data.source).info);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/skills", (c) => c.json(skills.list(agents.all().map((a) => ({ id: a.info.id, skills: a.skills })))));

  // Skills 2.0 (upgrade A2): attach to agents in one click, import from GitHub, delete.
  app.put("/api/skills/:name/agents", async (c) => {
    const name = c.req.param("name");
    const parsed = z.object({ agents: z.array(z.string()).max(100) }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    if (!skills.list().some((s) => s.name === name)) return c.json({ error: `no skill named ${name}` }, 404);
    const want = new Set(parsed.data.agents);
    try {
      for (const a of agents.all()) {
        if (a.info.id === "ceo") continue;
        const has = a.skills.includes(name);
        if (has !== want.has(a.info.id)) agents.setSkills(a.info.id, has ? a.skills.filter((s) => s !== name) : [...a.skills, name]);
      }
      return c.json(skills.list(agents.all().map((a) => ({ id: a.info.id, skills: a.skills }))).find((s) => s.name === name));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/skills/import", async (c) => {
    const parsed = z.object({ url: z.string().min(1).max(500), name: z.string().max(64).optional(), overwrite: z.boolean().default(false) }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    try {
      const result = await importSkill({ ...parsed.data, skillsDir: skills.directory, token: config.githubToken, apiUrl: config.githubApiUrl });
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof SkillImportError) return c.json({ error: err.message, choices: err.choices }, 400);
      return fail(c, err);
    }
  });

  app.delete("/api/skills/:name", (c) => {
    const name = c.req.param("name");
    try {
      for (const a of agents.all()) if (a.skills.includes(name)) agents.setSkills(a.info.id, a.skills.filter((s) => s !== name));
      skills.remove(name);
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/skills/:name", (c) => {
    try {
      return c.json({ name: c.req.param("name"), source: skills.read(c.req.param("name")) });
    } catch (err) {
      return c.json({ error: message(err) }, 404);
    }
  });

  app.put("/api/skills/:name", async (c) => {
    const parsed = z.object({ source: z.string().min(1).max(100_000) }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "source is required" }, 400);
    try {
      skills.save(c.req.param("name"), parsed.data.source);
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/integrations", (c) => {
    integrations.reload();
    return c.json({ error: integrations.error, servers: integrations.list(agents.all().map((a) => ({ id: a.info.id, integrations: a.integrations }))) });
  });

  // ---- workflows & templates ---------------------------------------------------------------

  app.get("/api/workflows", (c) => c.json(workflows.list()));

  app.get("/api/workflows/:id", (c) => {
    const wf = workflows.get(c.req.param("id"));
    return wf ? c.json({ ...wf, versions: workflows.versions(wf.id) }) : c.json({ error: "workflow not found" }, 404);
  });

  // Shareable JSON (import it again with POST /api/workflows or drop it into templates/).
  app.get("/api/workflows/:id/export", (c) => {
    const wf = workflows.get(c.req.param("id"));
    if (!wf) return c.json({ error: "workflow not found" }, 404);
    const { name, description, prompt, params, steps, summary, positions } = wf;
    c.header("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]+/g, "-").toLowerCase()}.json"`);
    return c.json({ name, description, prompt, params, steps, summary, positions });
  });

  app.get("/api/templates", (c) => c.json(WorkflowStore.templates(templatesDir)));

  app.post("/api/workflows", async (c) => {
    const raw = (await body(c)) as Record<string, unknown> | null;
    if (raw && typeof raw.fromRunId === "string") {
      const input = workflows.fromRun(raw.fromRunId, typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Saved workflow");
      if (!input) return c.json({ error: "that run has no team plan to save" }, 400);
      return c.json(workflows.create(input, raw.fromRunId), 201);
    }
    if (raw && typeof raw.fromTemplate === "string") {
      const tpl = WorkflowStore.templates(templatesDir).find((t) => t.id === raw.fromTemplate);
      if (!tpl) return c.json({ error: "template not found" }, 404);
      const { id: _id, ...input } = tpl;
      return c.json(workflows.create(input), 201);
    }
    const parsed = WorkflowInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    const unknown = parsed.data.steps.find((st) => !agents.get(st.agent) || st.agent === "ceo");
    if (unknown) return c.json({ error: `unknown agent "${unknown.agent}"` }, 400);
    return c.json(workflows.create(parsed.data), 201);
  });

  app.put("/api/workflows/:id", async (c) => {
    const parsed = WorkflowInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    const unknown = parsed.data.steps.find((st) => !agents.get(st.agent) || st.agent === "ceo");
    if (unknown) return c.json({ error: `unknown agent "${unknown.agent}"` }, 400);
    const wf = workflows.update(c.req.param("id"), parsed.data);
    return wf ? c.json(wf) : c.json({ error: "workflow not found" }, 404);
  });

  app.delete("/api/workflows/:id", (c) => c.json({ ok: workflows.delete(c.req.param("id")) }));

  // ---- triggers ----------------------------------------------------------------------------

  const fire: Fire = (t, params) =>
    launcher.start({ prompt: params.prompt ?? "", workflowId: t.workflowId, params, profile: t.profile, approvalMode: t.approvalMode, origin: `trigger:${t.id}`, createdBy: t.name || "trigger" }).runId;

  app.get("/api/triggers", (c) => {
    const role = c.get("user")?.role;
    // Secrets (webhook URLs) are for owners only.
    return c.json(triggers.list().map((t) => (role === "owner" ? t : { ...t, secret: "" })));
  });

  app.post("/api/triggers", async (c) => {
    const parsed = TriggerInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    if (!workflows.get(parsed.data.workflowId)) return c.json({ error: "workflow not found" }, 404);
    try {
      return c.json(triggers.create(parsed.data), 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.put("/api/triggers/:id", async (c) => {
    const parsed = TriggerInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
    try {
      const t = triggers.update(c.req.param("id"), parsed.data);
      return t ? c.json(t) : c.json({ error: "trigger not found" }, 404);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete("/api/triggers/:id", (c) => c.json({ ok: triggers.delete(c.req.param("id")) }));

  // Manual "run now" from the UI.
  app.post("/api/triggers/:id/run", (c) => {
    const t = triggers.get(c.req.param("id"));
    if (!t) return c.json({ error: "trigger not found" }, 404);
    const runId = runTrigger(triggers, fire, t, t.params);
    return runId ? c.json({ runId }) : c.json({ error: triggers.get(t.id)?.lastError ?? "could not start" }, 400);
  });

  // Webhook endpoint: GitHub (X-Hub-Signature-256 with the trigger secret) or any client with X-Claudestra-Secret / ?secret=.
  app.post("/api/triggers/:id/fire", async (c) => {
    const t = triggers.get(c.req.param("id"));
    if (!t || t.kind !== "webhook") return c.json({ error: "trigger not found" }, 404);
    const raw = await c.req.text();
    if (!verifyWebhook(t, raw, { signature: c.req.header("x-hub-signature-256"), secret: c.req.header("x-claudestra-secret"), query: c.req.query("secret") })) {
      return c.json({ error: "bad signature or secret" }, 401);
    }
    if (!t.enabled) return c.json({ ok: true, skipped: "trigger disabled" });
    const event = c.req.header("x-github-event");
    if (event === "ping") return c.json({ ok: true, pong: true });
    let payload: unknown = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { prompt: raw.slice(0, 10_000) };
    }
    const runId = runTrigger(triggers, fire, t, { ...t.params, ...paramsFromPayload(payload, event) });
    return runId ? c.json({ ok: true, runId }, 202) : c.json({ error: triggers.get(t.id)?.lastError ?? "could not start" }, 409);
  });

  // ---- memory ------------------------------------------------------------------------------

  app.get("/api/memory", (c) => c.json({ enabled: memory.isEnabled, notes: memory.notes(), runs: memory.runs() }));
  app.post("/api/memory/notes", async (c) => {
    const parsed = z.object({ text: z.string().trim().min(1).max(1000) }).safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "text is required" }, 400);
    return c.json(memory.addNote(parsed.data.text), 201);
  });
  app.delete("/api/memory/notes/:id", (c) => c.json({ ok: memory.deleteNote(c.req.param("id")) }));
  app.delete("/api/memory/runs/:runId", (c) => c.json({ ok: memory.forget(c.req.param("runId")) }));

  // ---- evals -------------------------------------------------------------------------------

  app.get("/api/evals", (c) => c.json({ suites: evals.suites(), history: evals.history() }));
  app.post("/api/evals/:suite/run", (c) => {
    try {
      return c.json({ evalRunId: evals.start(c.req.param("suite"), c.get("user")?.name) }, 202);
    } catch (err) {
      return fail(c, err);
    }
  });

  // ---- analytics ---------------------------------------------------------------------------

  app.get("/api/analytics", (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
    return c.json({ ...analytics(store, days), dailyBudgetUsd: config.dailyBudgetUsd, monthlyBudgetUsd: config.monthlyBudgetUsd });
  });

  // ---- observer mode: Claude Code hooks POST here (via bin/claudestra-hook.mjs) -------------

  app.post("/hooks/:event", async (c) => {
    if (access.enabled) {
      const given = c.req.header("x-claudestra-secret");
      const ok = s.hooksSecret ? Boolean(given) && safeEqual(given!, s.hooksSecret) : isLoopback(remoteAddress(c));
      if (!ok) return c.json({ error: "hooks need HOOKS_SECRET or a local connection" }, 401);
    }
    const event = c.req.param("event");
    const payload = ((await body(c)) ?? {}) as HookPayload;
    // The id becomes a run id and a folder name: only letters, digits, - and _.
    const rawId = typeof payload.session_id === "string" ? payload.session_id : "unknown-session";
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(rawId)) return c.json({ error: "invalid session_id" }, 400);
    const sessionId = rawId;
    const runId = `obs-${sessionId}`;

    // Observer runs are view-only: events keep being recorded even after SessionEnd or a server restart.
    if (!store.has(runId)) {
      const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
      const label = `Claude Code session${cwd ? ` · ${cwd}` : ""}`;
      store.create({ id: runId, prompt: label, source: "observer" });
      store.append(runId, { type: "run.started", data: { prompt: label, source: "observer", authMode: "observer", budgetUsd: null, agents: [] } });
      store.append(runId, { type: "step.started", data: { task: label, model: "claude-code", tools: [] } }, { stepId: "s1", agentId: "claude-code" });
    }
    const mapper = observers.get(runId) ?? new HookEventMapper();
    observers.set(runId, mapper);
    for (const data of mapper.map(event, payload)) {
      store.append(runId, data, data.type.startsWith("run.") ? {} : { stepId: "s1", agentId: "claude-code" });
    }
    return c.json({ ok: true });
  });

  return app;
}
