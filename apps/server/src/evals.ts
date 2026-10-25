// Agent evals (docs/10 Phase 5): suites of prompts with checks, run as normal runs and scored, so prompt or
// model changes can be compared on quality and cost.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApprovalMode, Profile } from "@claudestra/protocol";
import type { RunStore } from "./store.ts";
import type { RunLauncher } from "./runs.ts";
import { readWorkspaceFile } from "./files.ts";

const Check = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), equals: z.enum(["completed", "failed", "cancelled"]).default("completed") }),
  z.object({ type: z.literal("route"), equals: z.enum(["direct", "single_agent", "team"]) }),
  z.object({ type: z.literal("answer_contains"), value: z.string(), caseSensitive: z.boolean().default(false) }),
  z.object({ type: z.literal("answer_regex"), pattern: z.string() }),
  z.object({ type: z.literal("file_exists"), path: z.string() }),
  z.object({ type: z.literal("file_contains"), path: z.string(), value: z.string() }),
  z.object({ type: z.literal("max_cost"), usd: z.number().positive() }),
  z.object({ type: z.literal("max_steps"), n: z.number().int().positive() }),
  z.object({ type: z.literal("agents_include"), agents: z.array(z.string()) }),
  z.object({ type: z.literal("agents_exclude"), agents: z.array(z.string()) }),
]);
export type Check = z.infer<typeof Check>;

export const Suite = z.object({
  name: z.string(),
  description: z.string().default(""),
  profile: Profile.default("eco"),
  approvalMode: ApprovalMode.default("auto"),
  timeoutMinutes: z.number().positive().default(10),
  cases: z.array(z.object({ id: z.string(), prompt: z.string().min(1), checks: z.array(Check).default([{ type: "status", equals: "completed" }]) })).min(1),
});
export type Suite = z.infer<typeof Suite>;

export type CheckResult = { check: string; passed: boolean; detail: string };
export type CaseResult = { caseId: string; runId: string | null; passed: boolean; costUsd: number | null; checks: CheckResult[] };
export type EvalRun = { id: string; suite: string; status: "running" | "done"; startedAt: string; finishedAt: string | null; passed: number; total: number; costUsd: number; results: CaseResult[] };

type RunFacts = { status: string; answer: string; route: string | null; costUsd: number | null; steps: number; agents: string[]; workspace: string };

export function factsOf(store: RunStore, runId: string, workspacesDir: string): RunFacts {
  const events = store.events(runId);
  const plan = events.find((e) => e.type === "plan.created");
  const done = events.find((e) => e.type === "run.completed");
  const agents = new Set<string>();
  const steps = new Set<string>();
  for (const e of events) {
    if (e.type === "step.started" && e.stepId) {
      steps.add(e.stepId);
      if (e.agentId) agents.add(e.agentId);
    }
  }
  return {
    status: store.status(runId) ?? "unknown",
    answer: done?.type === "run.completed" ? done.data.answer : "",
    route: plan?.type === "plan.created" ? plan.data.plan.route : null,
    costUsd: done?.type === "run.completed" ? done.data.totalCostUsd : (store.list(1000).find((r) => r.id === runId)?.costUsd ?? null),
    steps: steps.size,
    agents: [...agents],
    workspace: path.join(workspacesDir, runId),
  };
}

export function score(check: Check, f: RunFacts): CheckResult {
  const r = (passed: boolean, detail: string): CheckResult => ({ check: check.type, passed, detail });
  const file = (p: string) => {
    try {
      return readWorkspaceFile(f.workspace, p).content;
    } catch {
      return null;
    }
  };
  switch (check.type) {
    case "status":
      return r(f.status === check.equals, `status ${f.status}`);
    case "route":
      return r(f.route === check.equals, `route ${f.route ?? "none"}`);
    case "answer_contains": {
      const ok = check.caseSensitive ? f.answer.includes(check.value) : f.answer.toLowerCase().includes(check.value.toLowerCase());
      return r(ok, ok ? `contains "${check.value}"` : `missing "${check.value}"`);
    }
    case "answer_regex":
      return r(new RegExp(check.pattern, "i").test(f.answer), `/${check.pattern}/`);
    case "file_exists":
      return r(file(check.path) !== null, check.path);
    case "file_contains": {
      const c = file(check.path);
      return r(c !== null && c.toLowerCase().includes(check.value.toLowerCase()), `${check.path} ∋ "${check.value}"`);
    }
    case "max_cost":
      return r(f.costUsd !== null && f.costUsd <= check.usd, `$${f.costUsd ?? "?"} ≤ $${check.usd}`);
    case "max_steps":
      return r(f.steps <= check.n, `${f.steps} steps ≤ ${check.n}`);
    case "agents_include": {
      const missing = check.agents.filter((a) => !f.agents.includes(a));
      return r(missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : `used ${check.agents.join(", ")}`);
    }
    case "agents_exclude": {
      const used = check.agents.filter((a) => f.agents.includes(a));
      return r(used.length === 0, used.length ? `used ${used.join(", ")}` : "none used");
    }
  }
}

export class Evals {
  private active = new Set<string>();

  constructor(private dir: string, private store: RunStore, private launcher: RunLauncher, private workspacesDir: string) {
    this.store.database.exec(`CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY, suite TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
      passed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, cost_usd REAL NOT NULL DEFAULT 0, results TEXT NOT NULL DEFAULT '[]')`);
    // Runs interrupted by a restart never finish.
    this.store.database.prepare("UPDATE eval_runs SET status = 'done', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'").run(new Date().toISOString());
  }

  suites(): (Suite & { file: string; error?: string })[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((file) => {
        try {
          return { ...Suite.parse(JSON.parse(readFileSync(path.join(this.dir, file), "utf8"))), file: file.replace(/\.json$/, "") };
        } catch (err) {
          return { name: file, description: "", profile: "eco" as const, approvalMode: "auto" as const, timeoutMinutes: 10, cases: [], file: file.replace(/\.json$/, ""), error: err instanceof Error ? err.message : String(err) };
        }
      });
  }

  history(limit = 30): EvalRun[] {
    return (this.store.database.prepare("SELECT * FROM eval_runs ORDER BY started_at DESC LIMIT ?").all(limit) as { id: string; suite: string; status: "running" | "done"; started_at: string; finished_at: string | null; passed: number; total: number; cost_usd: number; results: string }[]).map((r) => ({
      id: r.id, suite: r.suite, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, passed: r.passed, total: r.total, costUsd: r.cost_usd, results: JSON.parse(r.results),
    }));
  }

  // Starts a suite in the background; cases run one after another to keep spend predictable.
  start(file: string, createdBy?: string): string {
    const suite = this.suites().find((s) => s.file === file);
    if (!suite || suite.error) throw new Error(suite?.error ?? "suite not found");
    if (this.active.has(file)) throw new Error("this suite is already running");
    const id = randomUUID();
    this.store.database.prepare("INSERT INTO eval_runs (id, suite, status, started_at, total) VALUES (?, ?, 'running', ?, ?)").run(id, file, new Date().toISOString(), suite.cases.length);
    this.active.add(file);
    void this.execute(id, suite, createdBy).finally(() => this.active.delete(file));
    return id;
  }

  private save(id: string, results: CaseResult[], done: boolean) {
    const passed = results.filter((r) => r.passed).length;
    const cost = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    this.store.database
      .prepare("UPDATE eval_runs SET results = ?, passed = ?, cost_usd = ?, status = ?, finished_at = ? WHERE id = ?")
      .run(JSON.stringify(results), passed, cost, done ? "done" : "running", done ? new Date().toISOString() : null, id);
  }

  private async execute(id: string, suite: Suite, createdBy?: string) {
    const results: CaseResult[] = [];
    for (const c of suite.cases) {
      let runId: string | null = null;
      try {
        runId = this.launcher.start({ prompt: c.prompt, profile: suite.profile, approvalMode: suite.approvalMode, origin: `eval:${id}`, createdBy }).runId;
        const end = await this.launcher.waitForEnd(runId, suite.timeoutMinutes * 60_000);
        if (end === "timeout") this.onTimeout?.(runId);
        const facts = factsOf(this.store, runId, this.workspacesDir);
        const checks = c.checks.map((ch) => score(ch, facts));
        if (end === "timeout") checks.unshift({ check: "timeout", passed: false, detail: `no result after ${suite.timeoutMinutes} min (cancelled)` });
        results.push({ caseId: c.id, runId, passed: checks.every((x) => x.passed), costUsd: facts.costUsd, checks });
      } catch (err) {
        results.push({ caseId: c.id, runId, passed: false, costUsd: null, checks: [{ check: "start", passed: false, detail: err instanceof Error ? err.message : String(err) }] });
      }
      this.save(id, results, false);
    }
    this.save(id, results, true);
  }

  // Set by the server to cancel runs that time out.
  onTimeout?: (runId: string) => void;
}
