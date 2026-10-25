// Workflow triggers (docs/04 "triggers"): cron schedules and webhooks (generic or GitHub, HMAC-verified).
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApprovalMode, Profile } from "@claudestra/protocol";
import type { RunStore } from "./store.ts";
import { nextRun, parseCron } from "./cron.ts";
import { safeEqual } from "./access.ts";

export const TriggerInput = z.object({
  workflowId: z.string().min(1),
  kind: z.enum(["schedule", "webhook"]),
  cron: z.string().default(""),
  // Static parameters for the workflow; webhook payload values override them.
  params: z.record(z.string(), z.string()).default({}),
  profile: Profile.default("eco"),
  approvalMode: ApprovalMode.default("smart"),
  enabled: z.boolean().default(true),
  name: z.string().max(120).default(""),
});
export type TriggerInput = z.infer<typeof TriggerInput>;

export type Trigger = TriggerInput & { id: string; secret: string; lastRunAt: string | null; lastRunId: string | null; lastError: string | null; nextRunAt: string | null; createdAt: string };

type Row = { id: string; workflow_id: string; kind: "schedule" | "webhook"; cron: string; params: string; profile: string; approval_mode: string; enabled: number; name: string; secret: string; last_run_at: string | null; last_run_id: string | null; last_error: string | null; created_at: string };

export type Fire = (t: Trigger, params: Record<string, string>) => string; // returns runId, throws on refusal

export class TriggerStore {
  constructor(private store: RunStore) {
    this.store.database.exec(`CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, kind TEXT NOT NULL, cron TEXT NOT NULL DEFAULT '',
      params TEXT NOT NULL, profile TEXT NOT NULL, approval_mode TEXT NOT NULL, enabled INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL, last_run_at TEXT, last_run_id TEXT, last_error TEXT, created_at TEXT NOT NULL)`);
  }

  private toTrigger(r: Row): Trigger {
    const t: Trigger = {
      id: r.id, workflowId: r.workflow_id, kind: r.kind, cron: r.cron, params: JSON.parse(r.params), profile: r.profile as Trigger["profile"],
      approvalMode: r.approval_mode as Trigger["approvalMode"], enabled: Boolean(r.enabled), name: r.name, secret: r.secret,
      lastRunAt: r.last_run_at, lastRunId: r.last_run_id, lastError: r.last_error, nextRunAt: null, createdAt: r.created_at,
    };
    if (t.kind === "schedule" && t.enabled && t.cron) {
      try {
        t.nextRunAt = nextRun(t.cron)?.toISOString() ?? null;
      } catch {
        t.nextRunAt = null;
      }
    }
    return t;
  }

  list(): Trigger[] {
    return (this.store.database.prepare("SELECT * FROM triggers ORDER BY created_at").all() as Row[]).map((r) => this.toTrigger(r));
  }

  get(id: string): Trigger | undefined {
    const r = this.store.database.prepare("SELECT * FROM triggers WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toTrigger(r) : undefined;
  }

  private validate(input: TriggerInput) {
    if (input.kind === "schedule") parseCron(input.cron);
  }

  create(input: TriggerInput): Trigger {
    this.validate(input);
    const id = randomUUID();
    this.store.database
      .prepare("INSERT INTO triggers (id, workflow_id, kind, cron, params, profile, approval_mode, enabled, name, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.workflowId, input.kind, input.cron, JSON.stringify(input.params), input.profile, input.approvalMode, input.enabled ? 1 : 0, input.name, randomBytes(24).toString("base64url"), new Date().toISOString());
    return this.get(id)!;
  }

  update(id: string, input: TriggerInput): Trigger | undefined {
    this.validate(input);
    const res = this.store.database
      .prepare("UPDATE triggers SET workflow_id = ?, kind = ?, cron = ?, params = ?, profile = ?, approval_mode = ?, enabled = ?, name = ? WHERE id = ?")
      .run(input.workflowId, input.kind, input.cron, JSON.stringify(input.params), input.profile, input.approvalMode, input.enabled ? 1 : 0, input.name, id);
    return Number(res.changes) > 0 ? this.get(id) : undefined;
  }

  delete(id: string): boolean {
    return Number(this.store.database.prepare("DELETE FROM triggers WHERE id = ?").run(id).changes) > 0;
  }

  markRun(id: string, runId: string | null, error: string | null) {
    this.store.database.prepare("UPDATE triggers SET last_run_at = ?, last_run_id = ?, last_error = ? WHERE id = ?").run(new Date().toISOString(), runId, error, id);
  }
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastMinute = "";

  constructor(private triggers: TriggerStore, private fire: Fire) {}

  start(intervalMs = 15_000) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // Fires every enabled schedule matching the current minute, once per minute.
  tick(now = new Date()): string[] {
    const minute = now.toISOString().slice(0, 16);
    if (minute === this.lastMinute) return [];
    this.lastMinute = minute;
    const fired: string[] = [];
    for (const t of this.triggers.list()) {
      if (t.kind !== "schedule" || !t.enabled) continue;
      try {
        if (!parseCron(t.cron)(now)) continue;
      } catch {
        continue;
      }
      fired.push(runTrigger(this.triggers, this.fire, t, t.params));
    }
    return fired.filter(Boolean);
  }
}

export function runTrigger(store: TriggerStore, fire: Fire, t: Trigger, params: Record<string, string>): string {
  try {
    const runId = fire(t, params);
    store.markRun(t.id, runId, null);
    return runId;
  } catch (err) {
    store.markRun(t.id, null, err instanceof Error ? err.message : String(err));
    return "";
  }
}

// ---- webhooks ---------------------------------------------------------------------------------

export function verifyWebhook(t: Trigger, rawBody: string, headers: { signature?: string; secret?: string; query?: string }): boolean {
  if (headers.signature) {
    const expected = `sha256=${createHmac("sha256", t.secret).update(rawBody).digest("hex")}`;
    return safeEqual(headers.signature, expected);
  }
  const given = headers.secret ?? headers.query;
  return Boolean(given) && safeEqual(given!, t.secret);
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : undefined);

// Payload → workflow params. GitHub events get readable fields and a ready-made `prompt`.
export function paramsFromPayload(payload: unknown, githubEvent?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!payload || typeof payload !== "object") return out;
  const p = payload as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) {
    const s = str(v);
    if (s !== undefined && /^[a-zA-Z0-9_]+$/.test(k)) out[k] = s.slice(0, 10_000);
  }
  if (githubEvent) {
    const get = (path: string) => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), p);
    const item = (get("issue") ?? get("pull_request") ?? get("discussion")) as Record<string, unknown> | undefined;
    const fields = {
      github_event: githubEvent,
      github_action: str(get("action")) ?? "",
      repo: str(get("repository.full_name")) ?? "",
      sender: str(get("sender.login")) ?? "",
      title: str(item?.title) ?? str(get("head_commit.message")) ?? "",
      body: (str(item?.body) ?? str(get("comment.body")) ?? "").slice(0, 8000),
      url: str(item?.html_url) ?? str(get("compare")) ?? "",
    };
    Object.assign(out, fields);
    out.prompt ??= `GitHub ${fields.github_event}${fields.github_action ? ` (${fields.github_action})` : ""} in ${fields.repo}: ${fields.title}\n\n${fields.body}\n\n${fields.url}`.trim();
  }
  return out;
}
