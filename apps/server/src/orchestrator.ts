// Owns a run: CEO plans, steps run in dependency order (parallel where possible), CEO finalizes.
// docs/02 "Run lifecycle", docs/04 "Step lifecycle", docs/11 §2.3 budgets.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CEO_FINAL_STEP, CEO_PLAN_STEP, type EventData, type Plan, type PlanStep } from "@claudestra/protocol";
import type { Config } from "./config.ts";
import type { RunStore } from "./store.ts";
import type { AgentDefinition, AgentRegistry } from "./agents.ts";
import { resolveSdkAuth } from "./auth.ts";
import { runAgentSession, type SessionRunner } from "./session.ts";
import { buildFinalPrompt, buildPlanningPrompt, ceoDecisionSchema, extractJson, extractSummary, validatePlan, type StepReport } from "./plan.ts";

// Kept back from step budgets so the CEO can always write a final answer.
const FINAL_RESERVE_USD = 0.1;
const MIN_STEP_BUDGET_USD = 0.02;
const REPORTS_DIR = ".claudestra/reports";

type RunContext = {
  runId: string;
  prompt: string;
  workspace: string;
  env: Record<string, string | undefined>;
  controllers: Set<AbortController>;
  spentUsd: number;
  numTurns: number;
  warned: boolean;
  exceeded: boolean;
  startedAt: number;
};

export class Orchestrator {
  private runs = new Map<string, RunContext>();

  constructor(
    private config: Config,
    private store: RunStore,
    private agents: AgentRegistry,
    private runSession: SessionRunner = runAgentSession,
  ) {}

  async start(runId: string, prompt: string): Promise<void> {
    const auth = resolveSdkAuth(this.config.authMode, process.env);
    if (!auth.ok) throw new Error(auth.reason);
    const workspace = path.join(this.config.workspacesDir, runId);
    await mkdir(path.join(workspace, REPORTS_DIR), { recursive: true });

    const ctx: RunContext = {
      runId, prompt, workspace, env: auth.env, controllers: new Set(),
      spentUsd: 0, numTurns: 0, warned: false, exceeded: false, startedAt: Date.now(),
    };
    this.runs.set(runId, ctx);
    try {
      await this.execute(ctx);
    } catch (err) {
      this.emitRun(ctx, { type: "run.failed", data: { error: err instanceof Error ? err.message : String(err) } });
    } finally {
      this.runs.delete(runId);
    }
  }

  cancel(runId: string): boolean {
    const ctx = this.runs.get(runId);
    if (!ctx || this.store.status(runId) !== "running") return false;
    // Mark first so in-flight steps stop recording, then abort their sessions.
    this.store.append(runId, { type: "run.cancelled", data: { by: "user" } });
    for (const c of ctx.controllers) c.abort();
    return true;
  }

  private async execute(ctx: RunContext) {
    const ceo = this.agents.ceo();
    const roster = this.agents.specialists();

    // 1. Plan
    const planOutcome = await this.runStep(ctx, CEO_PLAN_STEP, ceo, "Plan the work", buildPlanningPrompt(ctx.prompt, roster, this.config.planSizeCap, this.config.runBudgetUsd), {
      outputSchema: ceoDecisionSchema,
      budgetUsd: Math.min(ceo.limits.maxBudgetUsd, this.config.runBudgetUsd),
    });
    if (!this.running(ctx)) return;
    if (!planOutcome.ok) throw new Error(`CEO planning failed: ${planOutcome.error ?? "unknown error"}`);

    let plan: Plan;
    let raw: unknown;
    try {
      raw = planOutcome.structured ?? extractJson(planOutcome.text);
      plan = validatePlan(raw, roster, this.config.planSizeCap);
    } catch (err) {
      throw new Error(`CEO returned an invalid plan: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.emitRun(ctx, { type: "plan.created", data: { plan } });

    // 2. Direct answer: the CEO alone.
    if (plan.route === "direct") {
      const answer = (raw as { directAnswer: string }).directAnswer;
      return this.complete(ctx, answer);
    }

    // 3. Execute steps.
    const reports = await this.executeSteps(ctx, plan);
    if (!this.running(ctx)) return;

    // 4. Single agent: its own report is the answer (saves a CEO call).
    const only = reports[0];
    if (plan.route === "single_agent" && only?.status === "succeeded") {
      return this.complete(ctx, only.report);
    }

    // 5. CEO finalizes from the reports.
    const remaining = this.config.runBudgetUsd - ctx.spentUsd;
    const finalBudget = Math.max(Math.min(ceo.limits.maxBudgetUsd, remaining), MIN_STEP_BUDGET_USD);
    const final = await this.runStep(ctx, CEO_FINAL_STEP, ceo, "Write the final answer", buildFinalPrompt(ctx.prompt, plan, reports), { budgetUsd: finalBudget });
    if (!this.running(ctx)) return;
    if (!final.ok) {
      const fallback = reports.map((r) => `## ${r.id} · ${r.agentName} (${r.status})\n${r.summary}`).join("\n\n");
      return this.complete(ctx, `The CEO could not write a final answer (${final.error}). Step summaries:\n\n${fallback}`);
    }
    this.complete(ctx, final.text);
  }

  private async executeSteps(ctx: RunContext, plan: Plan): Promise<StepReport[]> {
    const status = new Map<string, "pending" | "running" | "succeeded" | "failed" | "skipped">(plan.steps.map((s) => [s.id, "pending"]));
    const reports = new Map<string, StepReport>();
    const running = new Map<string, Promise<void>>();
    const byId = new Map(plan.steps.map((s) => [s.id, s]));

    const launch = (step: PlanStep) => {
      status.set(step.id, "running");
      const promise = this.runPlanStep(ctx, step, reports).then((report) => {
        reports.set(step.id, report);
        status.set(step.id, report.status === "succeeded" ? "succeeded" : "failed");
        running.delete(step.id);
      });
      running.set(step.id, promise);
    };

    while (this.running(ctx)) {
      // Skip steps whose inputs can no longer arrive.
      for (const step of plan.steps) {
        if (status.get(step.id) !== "pending") continue;
        const broken = step.dependsOn.find((d) => ["failed", "skipped"].includes(status.get(d)!));
        if (broken) {
          status.set(step.id, "skipped");
          const reason = `input step ${broken} did not succeed`;
          this.emitStep(ctx, step.id, step.agent, { type: "step.skipped", data: { reason } });
          reports.set(step.id, { id: step.id, agentName: this.agentName(step.agent), status: "skipped", summary: reason, report: "" });
        }
      }
      const ready = plan.steps.filter((s) => status.get(s.id) === "pending" && s.dependsOn.every((d) => status.get(d) === "succeeded"));
      for (const step of ready) {
        if (running.size >= this.config.maxConcurrentSteps) break;
        if (this.stepBudget(ctx, this.agents.get(step.agent)!) < MIN_STEP_BUDGET_USD) {
          status.set(step.id, "skipped");
          this.budgetExceeded(ctx);
          this.emitStep(ctx, step.id, step.agent, { type: "step.skipped", data: { reason: "run budget exhausted" } });
          reports.set(step.id, { id: step.id, agentName: this.agentName(step.agent), status: "skipped", summary: "skipped: run budget exhausted", report: "" });
          continue;
        }
        launch(step);
      }
      if (running.size === 0) {
        const stillPending = plan.steps.some((s) => status.get(s.id) === "pending");
        if (!stillPending) break;
        continue; // Skips/budget changes above may unblock or skip more steps.
      }
      await Promise.race(running.values());
    }

    if (!this.running(ctx)) {
      await Promise.allSettled(running.values());
      return [];
    }
    return plan.steps.map((s) => reports.get(s.id) ?? { id: s.id, agentName: this.agentName(byId.get(s.id)!.agent), status: "skipped", summary: "", report: "" });
  }

  private async runPlanStep(ctx: RunContext, step: PlanStep, reports: Map<string, StepReport>): Promise<StepReport> {
    const agent = this.agents.get(step.agent)!;
    const inputs = step.dependsOn.map((d) => reports.get(d)!).filter(Boolean);
    for (const input of inputs) {
      this.emitStep(ctx, step.id, step.agent, { type: "step.handoff", data: { from: input.id, to: step.id, summary: input.summary } });
    }
    const prompt = buildStepPrompt(ctx.prompt, step, inputs);
    const outcome = await this.runStep(ctx, step.id, agent, step.task, prompt, { budgetUsd: this.stepBudget(ctx, agent) });

    const report: StepReport = {
      id: step.id,
      agentName: agent.info.name,
      status: outcome.ok ? "succeeded" : "failed",
      summary: outcome.ok ? extractSummary(outcome.text) : `failed: ${outcome.error ?? "unknown error"}`,
      report: outcome.text,
    };
    if (outcome.text && this.running(ctx)) {
      const rel = `${REPORTS_DIR}/${step.id}-${agent.info.id}.md`;
      await writeFile(path.join(ctx.workspace, rel), outcome.text, "utf8");
      const bytes = Buffer.byteLength(outcome.text);
      const id = randomUUID();
      this.store.recordArtifact({ id, runId: ctx.runId, stepId: step.id, title: `${agent.info.name} report`, path: rel, bytes });
      this.emitStep(ctx, step.id, step.agent, { type: "artifact.created", data: { id, title: `${agent.info.name} report`, path: rel, bytes } });
      report.reportPath = rel;
    }
    return report;
  }

  private async runStep(
    ctx: RunContext,
    stepId: string,
    agent: AgentDefinition,
    task: string,
    prompt: string,
    opts: { budgetUsd: number; outputSchema?: Record<string, unknown> },
  ) {
    const controller = new AbortController();
    ctx.controllers.add(controller);
    this.emitStep(ctx, stepId, agent.info.id, { type: "step.ready", data: { task } });
    try {
      const outcome = await this.runSession({
        agent,
        prompt,
        task,
        workspace: ctx.workspace,
        model: this.config.models[agent.info.modelClass],
        budgetUsd: opts.budgetUsd,
        env: ctx.env,
        controller,
        emit: (event) => this.emitStep(ctx, stepId, agent.info.id, event),
        outputSchema: opts.outputSchema,
        claudeCodePath: this.config.claudeCodePath,
      });
      ctx.spentUsd += outcome.costUsd ?? 0;
      ctx.numTurns += outcome.numTurns;
      this.checkBudget(ctx);
      return outcome;
    } finally {
      ctx.controllers.delete(controller);
    }
  }

  private stepBudget(ctx: RunContext, agent: AgentDefinition): number {
    return Math.min(agent.limits.maxBudgetUsd, this.config.runBudgetUsd - ctx.spentUsd - FINAL_RESERVE_USD);
  }

  private checkBudget(ctx: RunContext) {
    const limit = this.config.runBudgetUsd;
    if (!ctx.warned && ctx.spentUsd >= limit * 0.8) {
      ctx.warned = true;
      this.emitRun(ctx, { type: "budget.warning", data: { spentUsd: ctx.spentUsd, limitUsd: limit } });
    }
  }

  private budgetExceeded(ctx: RunContext) {
    if (ctx.exceeded) return;
    ctx.exceeded = true;
    this.emitRun(ctx, { type: "budget.exceeded", data: { spentUsd: ctx.spentUsd, limitUsd: this.config.runBudgetUsd } });
  }

  private complete(ctx: RunContext, answer: string) {
    this.emitRun(ctx, {
      type: "run.completed",
      data: { answer, totalCostUsd: round(ctx.spentUsd), durationMs: Date.now() - ctx.startedAt, numTurns: ctx.numTurns },
    });
  }

  private running(ctx: RunContext): boolean {
    return this.store.status(ctx.runId) === "running";
  }

  private agentName(id: string): string {
    return this.agents.get(id)?.info.name ?? id;
  }

  private emitRun(ctx: RunContext, event: EventData) {
    if (!this.running(ctx)) return;
    this.store.append(ctx.runId, event);
  }

  private emitStep(ctx: RunContext, stepId: string, agentId: string, event: EventData) {
    if (!this.running(ctx)) return;
    if (event.type === "usage.updated") {
      // Run total = finished steps + this step's final cost (when known).
      event = { ...event, data: { ...event.data, runCostUsd: round(ctx.spentUsd + (event.data.costUsd ?? 0)) } };
    }
    this.store.append(ctx.runId, event, { stepId, agentId });
  }
}

export function buildStepPrompt(request: string, step: PlanStep, inputs: StepReport[]): string {
  const sections = [
    `# Client request\n${request}`,
    `# Your task (step ${step.id})\n${step.task}${step.successCriteria ? `\n\nSuccess criteria: ${step.successCriteria}` : ""}`,
  ];
  if (inputs.length > 0) {
    sections.push(
      `# Input from earlier steps\n${inputs
        .map((i) => `## ${i.id} · ${i.agentName}\n${i.summary}${i.reportPath ? `\n(Full report: ${i.reportPath})` : ""}`)
        .join("\n\n")}`,
    );
  }
  return sections.join("\n\n");
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
