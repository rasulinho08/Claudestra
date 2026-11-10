// Automations (docs/20): ready-made recurring jobs. One switch creates the workflow from its template and a schedule
// trigger for it, so nobody has to build workflows and cron lines by hand. Results arrive in the app and, when the
// Telegram bot is on, in Telegram. They are ordinary triggers and workflows underneath (docs/04).
import { z } from "zod";
import type { RunStore } from "./store.ts";
import { WorkflowStore } from "./workflows.ts";
import type { Trigger, TriggerStore } from "./triggers.ts";
import { parseCron } from "./cron.ts";

export type Preset = {
  id: string;
  template: string; // templates/<template>.json
  cron: string; // default schedule, in the server's local time
  // Parameters the person may change (the rest keep the template's defaults).
  fields: string[];
};

export const PRESETS: Preset[] = [
  { id: "morning-brief", template: "morning-brief", cron: "30 8 * * 1-5", fields: ["language"] },
  { id: "inbox-digest", template: "inbox-digest", cron: "0 8 * * 1-5", fields: ["window", "drafts", "language"] },
  { id: "sprint-report", template: "sprint-report", cron: "0 17 * * 5", fields: ["sprint_hint", "language"] },
  { id: "market-watch", template: "market-watch", cron: "0 9 * * *", fields: ["topics", "competitors", "days", "language"] },
  { id: "weekly-social", template: "weekly-social", cron: "0 10 * * 1", fields: ["prompt", "count", "language"] },
];

export const AutomationInput = z.object({
  cron: z.string().max(60).optional(),
  params: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.string().max(2000)).default({}),
});

export type AutomationView = {
  id: string;
  enabled: boolean;
  available: boolean; // false when the template uses an agent that does not exist here
  cron: string;
  params: { key: string; label: string; value: string }[];
  triggerId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
};

const MARK = "__automation";

// Values every scheduled workflow may use: {{today}} and {{recent_work}} (what the AI team did in the last day).
export function contextParams(store: RunStore, now = new Date()): Record<string, string> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const runs = store.list(200).filter((r) => r.startedAt >= since && !(r.origin ?? "").startsWith("trigger:"));
  const lines = runs.slice(0, 25).map((r) => `- [${r.status}] ${r.prompt.replace(/\s+/g, " ").slice(0, 140)}${r.costUsd ? ` ($${r.costUsd.toFixed(2)})` : ""}`);
  const waiting = (store.database.prepare("SELECT COUNT(*) AS n FROM approvals a JOIN runs r ON r.id = a.run_id WHERE a.decision IS NULL AND r.status = 'running'").get() as { n: number }).n;
  const spent = store.spentSince(since);
  const recent = [
    runs.length ? `${runs.length} task(s) in the last 24 hours, $${spent.toFixed(2)} spent:` : "No tasks ran in the last 24 hours.",
    ...lines,
    waiting > 0 ? `${waiting} approval(s) are waiting for the owner right now.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { today, recent_work: recent };
}

export class Automations {
  constructor(
    private workflows: WorkflowStore,
    private triggers: TriggerStore,
    private templatesDir: string,
    private agentExists: (id: string) => boolean,
  ) {}

  private template(p: Preset) {
    return WorkflowStore.templates(this.templatesDir).find((t) => t.id === p.template);
  }

  private trigger(id: string): Trigger | undefined {
    return this.triggers.list().find((t) => t.params[MARK] === id);
  }

  list(): AutomationView[] {
    return PRESETS.flatMap((p) => {
      const tpl = this.template(p);
      if (!tpl) return [];
      const t = this.trigger(p.id);
      return [
        {
          id: p.id,
          enabled: Boolean(t?.enabled),
          available: tpl.steps.every((s) => this.agentExists(s.agent)),
          cron: t?.cron || p.cron,
          params: p.fields.flatMap((key) => {
            const def = tpl.params.find((x) => x.key === key);
            return def ? [{ key, label: def.label, value: t?.params[key] ?? def.default }] : [];
          }),
          triggerId: t?.id ?? null,
          nextRunAt: t?.nextRunAt ?? null,
          lastRunAt: t?.lastRunAt ?? null,
          lastRunId: t?.lastRunId ?? null,
          lastError: t?.lastError ?? null,
        },
      ];
    });
  }

  // Turns an automation on (or changes its schedule and settings).
  enable(id: string, input: z.infer<typeof AutomationInput>, title: string): AutomationView {
    const preset = PRESETS.find((p) => p.id === id);
    const tpl = preset && this.template(preset);
    if (!preset || !tpl) throw new Error("automation not found");
    const missing = tpl.steps.find((s) => !this.agentExists(s.agent));
    if (missing) throw new Error(`this automation needs the agent "${missing.agent}"`);
    // A parameter without a default (for example what to post about) must be given before it can run on its own.
    const earlier = this.trigger(id)?.params ?? {};
    const empty = tpl.params.find((x) => preset.fields.includes(x.key) && !x.default && !(input.params[x.key] ?? earlier[x.key] ?? "").trim());
    if (empty) throw new Error(`fill in "${empty.label || empty.key}" first`);
    const cron = input.cron?.trim() || this.trigger(id)?.cron || preset.cron;
    parseCron(cron);
    const params: Record<string, string> = { [MARK]: id };
    for (const key of preset.fields) if (input.params[key]?.trim()) params[key] = input.params[key]!.trim();
    const existing = this.trigger(id);
    // Keep earlier settings the person did not send this time.
    for (const [k, v] of Object.entries(existing?.params ?? {})) if (!(k in params) && preset.fields.includes(k) && !(k in input.params)) params[k] = v;
    const { id: _tplId, ...workflowInput } = tpl;
    const spec = { kind: "schedule" as const, cron, params, profile: "balanced" as const, approvalMode: "smart" as const, enabled: true, name: title.slice(0, 120) };
    if (existing) this.triggers.update(existing.id, { ...spec, workflowId: existing.workflowId });
    else this.triggers.create({ ...spec, workflowId: this.workflows.create(workflowInput).id });
    return this.list().find((a) => a.id === id)!;
  }

  disable(id: string): boolean {
    const t = this.trigger(id);
    if (!t) return false;
    this.triggers.update(t.id, { workflowId: t.workflowId, kind: "schedule", cron: t.cron, params: t.params, profile: t.profile, approvalMode: t.approvalMode, enabled: false, name: t.name });
    return true;
  }
}
