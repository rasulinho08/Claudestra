// Saved workflows (docs/04 "Workflow"): a plan template with {{params}}, versioned on every update.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Plan, PlanStep } from "@claudestra/protocol";
import type { RunStore } from "./store.ts";
import { fillTemplate } from "./plan.ts";

export const WorkflowParam = z.object({ key: z.string().regex(/^[a-zA-Z0-9_]+$/), label: z.string().default(""), default: z.string().default("") });

export const WorkflowInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  // The client request for runs of this workflow; may contain {{params}}.
  prompt: z.string().max(20_000).default("{{prompt}}"),
  params: z.array(WorkflowParam).default([{ key: "prompt", label: "Request", default: "" }]),
  steps: z.array(PlanStep).min(1).max(20),
  summary: z.string().default(""),
  // Node positions from the visual editor, keyed by step id.
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
});
export type WorkflowInput = z.infer<typeof WorkflowInput>;

export type Workflow = WorkflowInput & { id: string; version: number; sourceRunId: string | null; createdAt: string; updatedAt: string };

type Row = { id: string; name: string; description: string; params: string; definition: string; version: number; source_run_id: string | null; created_at: string; updated_at: string };

export class WorkflowStore {
  constructor(private store: RunStore) {}

  private get db() {
    return this.store.database;
  }

  private toWorkflow(r: Row): Workflow {
    const def = JSON.parse(r.definition) as { prompt: string; steps: WorkflowInput["steps"]; summary: string; positions?: WorkflowInput["positions"] };
    return { id: r.id, name: r.name, description: r.description, params: JSON.parse(r.params), prompt: def.prompt, steps: def.steps, summary: def.summary, positions: def.positions ?? {}, version: r.version, sourceRunId: r.source_run_id, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  list(): Workflow[] {
    return (this.db.prepare("SELECT * FROM workflows ORDER BY updated_at DESC").all() as Row[]).map((r) => this.toWorkflow(r));
  }

  get(id: string): Workflow | undefined {
    const row = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as Row | undefined;
    return row ? this.toWorkflow(row) : undefined;
  }

  versions(id: string): { version: number; createdAt: string }[] {
    return (this.db.prepare("SELECT version, created_at FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC").all(id) as { version: number; created_at: string }[]).map((r) => ({ version: r.version, createdAt: r.created_at }));
  }

  create(input: WorkflowInput, sourceRunId: string | null = null): Workflow {
    const id = randomUUID();
    const now = new Date().toISOString();
    const definition = JSON.stringify({ prompt: input.prompt, steps: input.steps, summary: input.summary, positions: input.positions });
    const params = JSON.stringify(input.params);
    this.db
      .prepare("INSERT INTO workflows (id, name, description, params, definition, version, source_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .run(id, input.name, input.description, params, definition, sourceRunId, now, now);
    this.db.prepare("INSERT INTO workflow_versions (workflow_id, version, definition, params, created_at) VALUES (?, 1, ?, ?, ?)").run(id, definition, params, now);
    return this.get(id)!;
  }

  update(id: string, input: WorkflowInput): Workflow | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const version = current.version + 1;
    const definition = JSON.stringify({ prompt: input.prompt, steps: input.steps, summary: input.summary, positions: input.positions });
    const params = JSON.stringify(input.params);
    this.db.prepare("UPDATE workflows SET name = ?, description = ?, params = ?, definition = ?, version = ?, updated_at = ? WHERE id = ?").run(input.name, input.description, params, definition, version, now, id);
    this.db.prepare("INSERT INTO workflow_versions (workflow_id, version, definition, params, created_at) VALUES (?, ?, ?, ?, ?)").run(id, version, definition, params, now);
    return this.get(id);
  }

  delete(id: string): boolean {
    this.db.prepare("DELETE FROM workflow_versions WHERE workflow_id = ?").run(id);
    return Number(this.db.prepare("DELETE FROM workflows WHERE id = ?").run(id).changes) > 0;
  }

  // Template gallery: templates/*.json in WorkflowInput format (shareable, importable).
  static templates(dir: string): (WorkflowInput & { id: string })[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .flatMap((f) => {
        try {
          return [{ ...WorkflowInput.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))), id: f.replace(/\.json$/, "") }];
        } catch {
          return [];
        }
      });
  }

  // Template from a finished run: its prompt becomes {{prompt}}, its plan the steps.
  fromRun(runId: string, name: string): WorkflowInput | undefined {
    const events = this.store.events(runId);
    const started = events.find((e) => e.type === "run.started");
    const planned = events.find((e) => e.type === "plan.created");
    if (!started || started.type !== "run.started" || !planned || planned.type !== "plan.created" || planned.data.plan.steps.length === 0) return undefined;
    const prompt = started.data.prompt;
    const steps = planned.data.plan.steps.map((s) => ({ ...s, task: s.task.split(prompt).join("{{prompt}}") }));
    return WorkflowInput.parse({
      name,
      description: `Saved from run of ${new Date(started.ts).toLocaleString()}`,
      prompt: "{{prompt}}",
      params: [{ key: "prompt", label: "Request", default: prompt }],
      steps,
      summary: planned.data.plan.summary,
    });
  }

  // Concrete plan + prompt for a run with the given params.
  instantiate(wf: Workflow, params: Record<string, string>): { prompt: string; plan: Plan } {
    const values = Object.fromEntries(wf.params.map((p) => [p.key, params[p.key]?.trim() || p.default]));
    for (const p of wf.params) if (!values[p.key]) throw new Error(`parameter "${p.key}" is required`);
    const plan = Plan.parse({
      route: "team",
      summary: fillTemplate(wf.summary || wf.name, values),
      steps: wf.steps.map((s) => ({ ...s, task: fillTemplate(s.task, values), successCriteria: fillTemplate(s.successCriteria, values) })),
    });
    return { prompt: fillTemplate(wf.prompt, values), plan };
  }
}
