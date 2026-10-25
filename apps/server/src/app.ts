import { randomUUID } from "node:crypto";
import path from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ApprovalDecision, CreateRunRequest, type ClaudestraEvent, type HealthResponse } from "@claudestra/protocol";
import type { Config } from "./config.ts";
import { resolveSdkAuth } from "./auth.ts";
import type { RunStore } from "./store.ts";
import type { AgentRegistry } from "./agents.ts";
import type { StartOptions } from "./orchestrator.ts";
import { HookEventMapper, type HookPayload } from "./hook-mapper.ts";
import type { SkillLibrary } from "./skills.ts";
import type { IntegrationRegistry } from "./integrations.ts";
import { WorkflowInput, type WorkflowStore } from "./workflows.ts";
import { analytics, startOfDay, startOfMonth } from "./analytics.ts";
import { listFiles, readWorkspaceFile } from "./files.ts";

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
};

const HEARTBEAT_MS = 15_000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function body(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export function createApp(s: Services) {
  const { config, store, agents, runner, skills, integrations, workflows } = s;
  const app = new Hono();
  const observers = new Map<string, HookEventMapper>();

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
    };
    return c.json(res);
  });

  // ---- runs -------------------------------------------------------------------------------

  app.get("/api/runs", (c) => c.json(store.list()));

  app.post("/api/runs", async (c) => {
    const parsed = CreateRunRequest.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    const auth = resolveSdkAuth(config.authMode, process.env);
    if (!auth.ok) return c.json({ error: auth.reason }, 409);

    // Daily / monthly caps (docs/11 §2.3) are checked before any spend.
    if (config.dailyBudgetUsd !== null && store.spentSince(startOfDay()) >= config.dailyBudgetUsd) {
      return c.json({ error: `Daily budget of $${config.dailyBudgetUsd} reached` }, 429);
    }
    if (config.monthlyBudgetUsd !== null && store.spentSince(startOfMonth()) >= config.monthlyBudgetUsd) {
      return c.json({ error: `Monthly budget of $${config.monthlyBudgetUsd} reached` }, 429);
    }

    const req = parsed.data;
    const profile = req.profile ?? config.defaultProfile;
    const approvalMode = req.approvalMode ?? config.defaultApprovalMode;
    let prompt = req.prompt;
    let plan: StartOptions["plan"];
    if (req.workflowId) {
      const wf = workflows.get(req.workflowId);
      if (!wf) return c.json({ error: "workflow not found" }, 404);
      try {
        ({ prompt, plan } = workflows.instantiate(wf, { prompt: req.prompt, ...req.params }));
      } catch (err) {
        return c.json({ error: message(err) }, 400);
      }
      const unknown = plan.steps.find((st) => !agents.get(st.agent) || st.agent === "ceo");
      if (unknown) return c.json({ error: `workflow uses unknown agent "${unknown.agent}"` }, 400);
    }
    if (!prompt) return c.json({ error: "prompt is required" }, 400);

    const runId = randomUUID();
    store.create({ id: runId, prompt, source: "claudestra" });
    store.append(runId, {
      type: "run.started",
      data: {
        prompt,
        source: "claudestra",
        authMode: config.authMode,
        budgetUsd: config.profiles[profile].budgetUsd,
        agents: agents.infos(),
        profile,
        approvalMode,
        mode: plan ? "workflow" : "dynamic",
        workflowId: req.workflowId,
      },
    });
    runner.start(runId, { prompt, profile, approvalMode, plan }).catch((err: unknown) => {
      if (store.status(runId) === "running") store.append(runId, { type: "run.failed", data: { error: message(err) } });
    });
    return c.json({ runId }, 201);
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
    return c.json(listFiles(path.join(config.workspacesDir, id)));
  });

  app.get("/api/runs/:id/file", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    try {
      return c.json(readWorkspaceFile(path.join(config.workspacesDir, id), c.req.query("path") ?? ""));
    } catch (err) {
      return c.json({ error: message(err) }, 400);
    }
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
      return c.json({ error: message(err) }, 400);
    }
  });

  app.get("/api/skills", (c) => c.json(skills.list(agents.all().map((a) => ({ id: a.info.id, skills: a.skills })))));

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
      return c.json({ error: message(err) }, 400);
    }
  });

  app.get("/api/integrations", (c) => {
    integrations.reload();
    return c.json({ error: integrations.error, servers: integrations.list(agents.all().map((a) => ({ id: a.info.id, integrations: a.integrations }))) });
  });

  // ---- workflows ---------------------------------------------------------------------------

  app.get("/api/workflows", (c) => c.json(workflows.list()));

  app.get("/api/workflows/:id", (c) => {
    const wf = workflows.get(c.req.param("id"));
    return wf ? c.json({ ...wf, versions: workflows.versions(wf.id) }) : c.json({ error: "workflow not found" }, 404);
  });

  app.post("/api/workflows", async (c) => {
    const raw = (await body(c)) as Record<string, unknown> | null;
    if (raw && typeof raw.fromRunId === "string") {
      const input = workflows.fromRun(raw.fromRunId, typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Saved workflow");
      if (!input) return c.json({ error: "that run has no team plan to save" }, 400);
      return c.json(workflows.create(input, raw.fromRunId), 201);
    }
    const parsed = WorkflowInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") }, 400);
    return c.json(workflows.create(parsed.data), 201);
  });

  app.put("/api/workflows/:id", async (c) => {
    const parsed = WorkflowInput.safeParse(await body(c));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") }, 400);
    const wf = workflows.update(c.req.param("id"), parsed.data);
    return wf ? c.json(wf) : c.json({ error: "workflow not found" }, 404);
  });

  app.delete("/api/workflows/:id", (c) => c.json({ ok: workflows.delete(c.req.param("id")) }));

  // ---- analytics ---------------------------------------------------------------------------

  app.get("/api/analytics", (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
    return c.json({ ...analytics(store, days), dailyBudgetUsd: config.dailyBudgetUsd, monthlyBudgetUsd: config.monthlyBudgetUsd });
  });

  // ---- observer mode: Claude Code hooks POST here (via bin/claudestra-hook.mjs) -------------

  app.post("/hooks/:event", async (c) => {
    const event = c.req.param("event");
    const payload = ((await body(c)) ?? {}) as HookPayload;
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : "unknown-session";
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
