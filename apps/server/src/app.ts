import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { CreateRunRequest, type ClaudestraEvent, type HealthResponse } from "@claudestra/protocol";
import type { Config } from "./config.ts";
import { resolveSdkAuth } from "./auth.ts";
import type { RunStore } from "./store.ts";
import type { AgentRegistry } from "./agents.ts";
import { HookEventMapper, type HookPayload } from "./hook-mapper.ts";

export type RunStarter = { start(runId: string, prompt: string): Promise<void>; cancel(runId: string): boolean };

const HEARTBEAT_MS = 15_000;

export function createApp(config: Config, store: RunStore, agents: AgentRegistry, runner: RunStarter) {
  const app = new Hono();
  const observers = new Map<string, HookEventMapper>();

  app.get("/api/health", (c) => {
    const auth = resolveSdkAuth(config.authMode, process.env);
    const body: HealthResponse = {
      ok: true,
      authMode: config.authMode,
      canStartRuns: auth.ok,
      models: config.models,
      agents: agents.infos(),
      warning: auth.ok ? auth.warning : auth.reason,
    };
    return c.json(body);
  });

  app.get("/api/runs", (c) => c.json(store.list()));

  app.post("/api/runs", async (c) => {
    const parsed = CreateRunRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "prompt is required" }, 400);
    const auth = resolveSdkAuth(config.authMode, process.env);
    if (!auth.ok) return c.json({ error: auth.reason }, 409);

    const runId = randomUUID();
    const { prompt } = parsed.data;
    store.create({ id: runId, prompt, source: "claudestra" });
    store.append(runId, {
      type: "run.started",
      data: { prompt, source: "claudestra", authMode: config.authMode, budgetUsd: config.runBudgetUsd, agents: agents.infos() },
    });
    runner.start(runId, prompt).catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      if (store.status(runId) === "running") store.append(runId, { type: "run.failed", data: { error } });
    });
    return c.json({ runId }, 201);
  });

  app.post("/api/runs/:id/cancel", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    return c.json({ cancelled: runner.cancel(id) });
  });

  // SSE: replays stored events after Last-Event-ID (or ?after=), then streams live ones.
  app.get("/api/runs/:id/events", (c) => {
    const id = c.req.param("id");
    if (!store.has(id)) return c.json({ error: "run not found" }, 404);
    const after = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? 0) || 0;

    return streamSSE(c, async (stream) => {
      const queue: ClaudestraEvent[] = store.events(id);
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

  // Observer mode: Claude Code hooks POST here (via bin/claudestra-hook.mjs).
  app.post("/hooks/:event", async (c) => {
    const event = c.req.param("event");
    const payload = ((await c.req.json().catch(() => ({}))) ?? {}) as HookPayload;
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : "unknown-session";
    const runId = `obs-${sessionId}`;

    // Observer runs are view-only: events keep being recorded even after SessionEnd or a server restart.
    if (!store.has(runId)) {
      const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
      const label = `Claude Code session${cwd ? ` · ${cwd}` : ""}`;
      store.create({ id: runId, prompt: label, source: "observer" });
      store.append(runId, { type: "run.started", data: { prompt: label, source: "observer", authMode: "observer", budgetUsd: null, agents: [] } });
      store.append(runId, { type: "step.started", data: { task: label, model: "claude-code", tools: [] } }, { stepId: "s1", agentId: "claude-code" });
      observers.set(runId, new HookEventMapper());
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
