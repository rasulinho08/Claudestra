// Owns a run: CEO plans (or a saved workflow supplies the plan), steps run in dependency order with
// parallelism, approvals, pause, CEO review of failures, verifier loops, then the CEO finalizes.
// docs/02 "Run lifecycle", docs/04, docs/05 "Permission model", docs/11 §2.3 budgets.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CEO_FINAL_STEP,
  CEO_PLAN_STEP,
  CeoReview,
  type AnswerLanguage,
  type ApprovalMode,
  type EventData,
  type Plan,
  type PlannedStep,
  type Profile,
  type ProfileInfo,
} from "@claudestra/protocol";
import type { Config } from "./config.ts";
import type { RunStore } from "./store.ts";
import type { AgentDefinition, AgentRegistry } from "./agents.ts";
import { resolveSdkAuth } from "./auth.ts";
import { runAgentSession, type Authorization, type SessionRunner } from "./session.ts";
import { evaluate } from "./approvals.ts";
import type { SkillLibrary } from "./skills.ts";
import type { IntegrationRegistry } from "./integrations.ts";
import type { Memory } from "./memory.ts";
import type { SessionOutcome } from "./sdk-mapper.ts";
import {
  buildFinalPrompt,
  buildPlanningPrompt,
  buildReviewPrompt,
  ceoDecisionSchema,
  ceoReviewSchema,
  extractJson,
  extractSummary,
  validatePlan,
  verdictOf,
  type StepReport,
} from "./plan.ts";

// Kept back from step budgets so the CEO can always write a final answer.
const FINAL_RESERVE_USD = 0.1;
const MIN_STEP_BUDGET_USD = 0.02;
const REVIEW_BUDGET_USD = 0.05;
const REPORTS_DIR = ".claudestra/reports";

export type StartOptions = {
  prompt: string;
  profile: Profile;
  approvalMode: ApprovalMode;
  // Saved workflow plan: skips CEO planning (docs/04 "Workflow").
  plan?: Plan;
  language?: AnswerLanguage;
};

const LANGUAGE_NAMES: Record<Exclude<AnswerLanguage, "auto">, string> = { az: "Azerbaijani", en: "English", ru: "Russian", tr: "Turkish" };

// One prompt line, not a translator step (keeps cost flat).
export function languageRule(lang: AnswerLanguage = "auto"): string {
  return lang === "auto"
    ? "Language: write the final answer and any user-facing text in the same language as the client request."
    : `Language: write the final answer and any user-facing text (reports, README, UI text) in ${LANGUAGE_NAMES[lang]}. Keep code, identifiers and file names in English.`;
}

type Pending = { resolve: (d: { decision: "approve" | "approve_run" | "reject"; note: string }) => void; kind: "tool" | "plan" };

type RunContext = {
  runId: string;
  prompt: string;
  profile: ProfileInfo;
  approvalMode: ApprovalMode;
  workspace: string;
  env: Record<string, string | undefined>;
  controllers: Set<AbortController>;
  pending: Map<string, Pending>;
  approvedForRun: Set<string>;
  paused: boolean;
  resumeWaiters: Array<() => void>;
  stepCost: Map<string, number>;
  spentUsd: number;
  numTurns: number;
  warned: boolean;
  exceeded: boolean;
  startedAt: number;
  // Owner notes from memory, added to every step prompt.
  notes: string;
  language: AnswerLanguage;
};

type StepResult = StepReport & { decision?: "continue" | "finish" };

export type OrchestratorDeps = {
  runSession?: SessionRunner;
  skills?: SkillLibrary;
  integrations?: IntegrationRegistry;
  memory?: Memory;
};

export class Orchestrator {
  private runs = new Map<string, RunContext>();
  private runSession: SessionRunner;

  constructor(
    private config: Config,
    private store: RunStore,
    private agents: AgentRegistry,
    private deps: OrchestratorDeps = {},
  ) {
    this.runSession = deps.runSession ?? runAgentSession;
  }

  async start(runId: string, opts: StartOptions): Promise<void> {
    const auth = resolveSdkAuth(this.config.authMode, process.env);
    if (!auth.ok) throw new Error(auth.reason);
    const workspace = path.join(this.config.workspacesDir, runId);
    await mkdir(path.join(workspace, REPORTS_DIR), { recursive: true });

    const ctx: RunContext = {
      runId,
      prompt: opts.prompt,
      profile: this.config.profiles[opts.profile],
      approvalMode: opts.approvalMode,
      workspace,
      env: auth.env,
      controllers: new Set(),
      pending: new Map(),
      approvedForRun: new Set(),
      paused: false,
      resumeWaiters: [],
      stepCost: new Map(),
      spentUsd: 0,
      numTurns: 0,
      warned: false,
      exceeded: false,
      startedAt: Date.now(),
      notes: "",
      language: opts.language ?? "auto",
    };
    this.runs.set(runId, ctx);
    try {
      await this.execute(ctx, opts.plan);
    } catch (err) {
      this.emitRun(ctx, { type: "run.failed", data: { error: err instanceof Error ? err.message : String(err) } });
    } finally {
      this.runs.delete(runId);
    }
  }

  isActive(runId: string): boolean {
    return this.runs.has(runId);
  }

  cancel(runId: string): boolean {
    const ctx = this.runs.get(runId);
    if (!ctx || this.store.status(runId) !== "running") return false;
    // Mark first so in-flight steps stop recording, then abort their sessions and pending waits.
    this.store.append(runId, { type: "run.cancelled", data: { by: "user" } });
    for (const c of ctx.controllers) c.abort();
    for (const p of ctx.pending.values()) p.resolve({ decision: "reject", note: "run cancelled" });
    this.wake(ctx);
    return true;
  }

  pause(runId: string): boolean {
    const ctx = this.runs.get(runId);
    if (!ctx || ctx.paused || !this.running(ctx)) return false;
    ctx.paused = true;
    this.emitRun(ctx, { type: "run.paused", data: { by: "user" } });
    return true;
  }

  resume(runId: string): boolean {
    const ctx = this.runs.get(runId);
    if (!ctx || !ctx.paused) return false;
    ctx.paused = false;
    this.emitRun(ctx, { type: "run.resumed", data: { by: "user" } });
    this.wake(ctx);
    return true;
  }

  decide(runId: string, approvalId: string, decision: "approve" | "approve_run" | "reject", note: string): boolean {
    const pending = this.runs.get(runId)?.pending.get(approvalId);
    if (!pending) return false;
    pending.resolve({ decision, note });
    return true;
  }

  private async execute(ctx: RunContext, suppliedPlan?: Plan) {
    const ceo = this.agents.ceo();
    const roster = this.agents.specialists();

    // 0. Memory: owner notes for everyone, related earlier runs for the CEO.
    const memory = this.deps.memory;
    ctx.notes = [memory?.notesBlock() ?? "", languageRule(ctx.language)].filter(Boolean).join("\n\n");
    const recalled = memory && !suppliedPlan ? memory.recall(ctx.prompt) : [];
    if (ctx.notes || recalled.length > 0) {
      this.emitRun(ctx, { type: "memory.recalled", data: { notes: memory?.notes().length ?? 0, runs: recalled.map((r) => ({ runId: r.runId, prompt: r.prompt.slice(0, 200) })) } });
    }
    const planningContext = [ctx.notes, memory?.recallBlock(recalled) ?? ""].filter(Boolean).join("\n\n");

    // 1. Plan (or take the workflow's plan).
    let plan: Plan;
    let directAnswer = "";
    if (suppliedPlan) {
      plan = validatePlan({ ...suppliedPlan, directAnswer: "" }, roster, Math.max(suppliedPlan.steps.length, 1));
    } else {
      const planningPrompt = buildPlanningPrompt(ctx.prompt, roster, ctx.profile.planSizeCap, ctx.profile.budgetUsd, planningContext);
      const planBudget = Math.min(ceo.limits.maxBudgetUsd, ctx.profile.budgetUsd);
      let prompt = planningPrompt;
      let parsed: { plan: Plan; directAnswer: string } | null = null;
      // A plan that fails validation goes back to the CEO once with the exact error (cheap, and common on non-Claude models).
      for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
        const planOutcome = await this.runStep(ctx, CEO_PLAN_STEP, ceo, attempt === 1 ? "Plan the work" : "Fix the plan", prompt, {
          outputSchema: ceoDecisionSchema,
          budgetUsd: planBudget,
          announce: attempt === 1,
        });
        if (!this.running(ctx)) return;
        if (!planOutcome.ok) throw new Error(`CEO planning failed: ${planOutcome.error ?? "unknown error"}`);
        try {
          const raw = planOutcome.structured ?? extractJson(planOutcome.text);
          parsed = { plan: validatePlan(raw, roster, ctx.profile.planSizeCap), directAnswer: (raw as { directAnswer?: string }).directAnswer ?? "" };
        } catch (err) {
          const problem = err instanceof Error ? err.message : String(err);
          if (attempt === 2) throw new Error(`CEO returned an invalid plan twice: ${problem}`);
          this.emitStep(ctx, CEO_PLAN_STEP, ceo.info.id, { type: "step.message", data: { messageId: randomUUID(), role: "system", partial: false, text: `Plan was invalid (${problem}); asking the CEO to fix it.` } });
          prompt = `${planningPrompt}\n\nYour previous reply was rejected: ${problem}\nPrevious reply:\n${(planOutcome.text || JSON.stringify(planOutcome.structured ?? "")).slice(0, 4000)}\n\nReturn a corrected JSON decision that fixes exactly this problem.`;
        }
      }
      plan = parsed!.plan;
      directAnswer = parsed!.directAnswer;
    }
    this.emitRun(ctx, { type: "plan.created", data: { plan } });

    // 2. Direct answer: the CEO alone.
    if (plan.route === "direct") return this.complete(ctx, directAnswer);

    // 3. Manual mode: the owner approves the plan first.
    if (ctx.approvalMode === "manual") {
      const approvalId = randomUUID();
      this.store.recordApproval({ id: approvalId, runId: ctx.runId, stepId: null, kind: "plan", request: plan });
      this.emitRun(ctx, { type: "plan.approval_requested", data: { approvalId } });
      const d = await this.waitForDecision(ctx, approvalId, "plan");
      if (!this.running(ctx)) return;
      this.store.decideApproval(approvalId, d.decision, "user", d.note);
      if (d.decision === "reject") {
        this.emitRun(ctx, { type: "plan.rejected", data: { approvalId, by: "user", note: d.note } });
        this.emitRun(ctx, { type: "run.failed", data: { error: `Plan rejected${d.note ? `: ${d.note}` : ""}` } });
        return;
      }
      this.emitRun(ctx, { type: "plan.approved", data: { approvalId, by: "user" } });
    }

    // 4. Execute steps.
    const reports = await this.executeSteps(ctx, plan);
    if (!this.running(ctx)) return;

    // 5. Single agent: its own report is the answer (saves a CEO call).
    const only = reports[0];
    if (plan.route === "single_agent" && only?.status === "succeeded") return this.complete(ctx, only.report);

    // 6. CEO finalizes from the reports.
    await this.waitIfPaused(ctx);
    if (!this.running(ctx)) return;
    const remaining = ctx.profile.budgetUsd - ctx.spentUsd;
    const finalBudget = Math.max(Math.min(ceo.limits.maxBudgetUsd, remaining), MIN_STEP_BUDGET_USD);
    const final = await this.runStep(ctx, CEO_FINAL_STEP, ceo, "Write the final answer", buildFinalPrompt(ctx.prompt, plan, reports, ctx.notes), { budgetUsd: finalBudget });
    if (!this.running(ctx)) return;
    if (!final.ok) {
      const fallback = reports.map((r) => `## ${r.id} · ${r.agentName} (${r.status})\n${r.summary}`).join("\n\n");
      return this.complete(ctx, `The CEO could not write a final answer (${final.error}). Step summaries:\n\n${fallback}`);
    }
    this.complete(ctx, final.text);
  }

  private async executeSteps(ctx: RunContext, plan: Plan): Promise<StepReport[]> {
    type S = "pending" | "running" | "succeeded" | "failed" | "skipped";
    const status = new Map<string, S>(plan.steps.map((s) => [s.id, "pending"]));
    const reports = new Map<string, StepReport>();
    const running = new Map<string, Promise<void>>();
    const continued = new Set<string>();
    let stopped = false;

    const skip = (step: PlannedStep, reason: string) => {
      status.set(step.id, "skipped");
      this.emitStep(ctx, step.id, step.agent, { type: "step.skipped", data: { reason } });
      reports.set(step.id, { id: step.id, agentName: this.agentName(step.agent), status: "skipped", summary: reason, report: "" });
    };

    const launch = (step: PlannedStep) => {
      status.set(step.id, "running");
      const promise = this.runPlanStep(ctx, plan, step, reports).then((result) => {
        reports.set(step.id, result);
        status.set(step.id, result.status === "succeeded" ? "succeeded" : "failed");
        if (result.decision === "continue") continued.add(step.id);
        if (result.decision === "finish") stopped = true;
        running.delete(step.id);
      });
      running.set(step.id, promise);
    };

    while (this.running(ctx)) {
      for (const step of plan.steps) {
        if (status.get(step.id) !== "pending") continue;
        if (stopped) {
          skip(step, "the CEO stopped the plan after a failure");
          continue;
        }
        // Skip steps whose inputs can no longer arrive.
        const broken = step.dependsOn.find((d) => status.get(d) === "skipped" || (status.get(d) === "failed" && !continued.has(d)));
        if (broken) skip(step, `input step ${broken} did not succeed`);
      }
      await this.waitIfPaused(ctx);
      if (!this.running(ctx)) break;

      const done = (d: string) => status.get(d) === "succeeded" || (status.get(d) === "failed" && continued.has(d));
      const ready = plan.steps.filter((s) => status.get(s.id) === "pending" && s.dependsOn.every(done));
      for (const step of ready) {
        if (running.size >= this.config.maxConcurrentSteps) break;
        if (this.stepBudget(ctx, this.agents.get(step.agent)!) < MIN_STEP_BUDGET_USD) {
          this.budgetExceeded(ctx);
          skip(step, "run budget exhausted");
          continue;
        }
        launch(step);
      }
      if (running.size === 0) {
        if (!plan.steps.some((s) => status.get(s.id) === "pending")) break;
        continue; // Skips/budget changes above may unblock or skip more steps.
      }
      await Promise.race(running.values());
    }

    if (!this.running(ctx)) {
      await Promise.allSettled(running.values());
      return [];
    }
    return plan.steps.map((s) => reports.get(s.id)!);
  }

  // One plan step: run, CEO review + retry on failure, then the verifier loop if the step has loopBackTo.
  private async runPlanStep(ctx: RunContext, plan: Plan, step: PlannedStep, reports: Map<string, StepReport>): Promise<StepResult> {
    const agent = this.agents.get(step.agent)!;
    const inputs = step.dependsOn.map((d) => reports.get(d)).filter((r): r is StepReport => Boolean(r));
    let task = step.task;
    let attempt = 1;
    let result: StepResult;

    for (;;) {
      result = await this.runAgentStep(ctx, step.id, agent, task, buildStepPrompt(ctx.prompt, { ...step, task }, inputs, ctx.notes), inputs, attempt === 1);
      if (result.status === "succeeded" || !this.running(ctx)) break;

      const review = await this.reviewFailure(ctx, plan, { ...step, task }, result.summary, attempt);
      this.emitRun(ctx, { type: "ceo.review", data: { stepId: step.id, action: review.action, note: review.note } });
      if (review.action === "retry" && attempt <= this.config.maxRetriesPerStep && this.stepBudget(ctx, agent) >= MIN_STEP_BUDGET_USD) {
        attempt++;
        task = review.revisedTask.trim() || task;
        this.emitStep(ctx, step.id, step.agent, { type: "step.retrying", data: { attempt, reason: review.note, task } });
        continue;
      }
      return { ...result, decision: review.action === "finish" ? "finish" : "continue" };
    }

    if (result.status !== "succeeded" || !step.loopBackTo || verdictOf(result.report) !== "changes") return result;
    return this.verifierLoop(ctx, plan, step, result, reports);
  }

  // Coder ⇄ reviewer: the target step fixes the verifier's findings, the verifier checks again (docs/03 "Agent-to-agent loops").
  private async verifierLoop(ctx: RunContext, plan: Plan, verifier: PlannedStep, first: StepResult, reports: Map<string, StepReport>): Promise<StepResult> {
    const target = plan.steps.find((s) => s.id === verifier.loopBackTo)!;
    const fixer = this.agents.get(target.agent)!;
    const checker = this.agents.get(verifier.agent)!;
    let last = first;
    let lastId = verifier.id;
    let targetReport = reports.get(target.id);

    for (let n = 2; n <= this.config.maxLoopIterations + 1; n++) {
      if (!this.running(ctx) || verdictOf(last.report) !== "changes") break;
      await this.waitIfPaused(ctx);
      if (this.stepBudget(ctx, fixer) < MIN_STEP_BUDGET_USD) {
        this.budgetExceeded(ctx);
        break;
      }
      const findings: StepReport = { ...last, id: lastId, summary: last.report.slice(0, 3000) };
      const fixId = `${target.id}-r${n}`;
      const fixTask = `Fix every must-fix finding from ${lastId} in the work of step ${target.id} (${target.task}). Change only what the findings require.`;
      this.emitStep(ctx, fixId, target.agent, { type: "step.added", data: { id: fixId, agent: target.agent, task: fixTask, dependsOn: [lastId], loopOf: target.id, iteration: n } });
      const fixInputs = targetReport ? [targetReport, findings] : [findings];
      const fix = await this.runAgentStep(ctx, fixId, fixer, fixTask, buildStepPrompt(ctx.prompt, { ...target, id: fixId, task: fixTask }, fixInputs, ctx.notes), [findings], true);
      if (fix.status !== "succeeded") break;
      targetReport = fix;

      const checkId = `${verifier.id}-r${n}`;
      this.emitStep(ctx, checkId, verifier.agent, { type: "step.added", data: { id: checkId, agent: verifier.agent, task: verifier.task, dependsOn: [fixId], loopOf: verifier.id, iteration: n } });
      const check = await this.runAgentStep(ctx, checkId, checker, verifier.task, buildStepPrompt(ctx.prompt, { ...verifier, id: checkId }, [fix], ctx.notes), [fix], true);
      if (check.status !== "succeeded") break;
      last = check;
      lastId = checkId;
    }
    const still = verdictOf(last.report) === "changes";
    return {
      ...last,
      id: verifier.id,
      summary: still ? `Still CHANGES REQUESTED after ${this.config.maxLoopIterations} fix round(s). ${last.summary}` : last.summary,
    };
  }

  private async reviewFailure(ctx: RunContext, plan: Plan, step: PlannedStep, error: string, attempt: number): Promise<CeoReview> {
    const fallback: CeoReview = { action: "continue", revisedTask: "", note: "no budget left for a CEO review" };
    const remaining = ctx.profile.budgetUsd - ctx.spentUsd;
    if (remaining < REVIEW_BUDGET_USD + FINAL_RESERVE_USD || error.includes("cancelled")) return fallback;
    await this.waitIfPaused(ctx);
    const ceo = this.agents.ceo();
    const outcome = await this.runStep(ctx, CEO_PLAN_STEP, ceo, `Review the failure of ${step.id}`, buildReviewPrompt(ctx.prompt, plan, step, error, attempt, remaining), {
      outputSchema: ceoReviewSchema,
      budgetUsd: REVIEW_BUDGET_USD,
      announce: false,
    });
    if (!outcome.ok) return { ...fallback, note: "CEO review failed; continuing without this step" };
    try {
      return CeoReview.parse(outcome.structured ?? extractJson(outcome.text));
    } catch {
      return { ...fallback, note: "CEO review was unreadable; continuing without this step" };
    }
  }

  // Runs one agent step with handoffs and saves its report as an artifact.
  private async runAgentStep(ctx: RunContext, stepId: string, agent: AgentDefinition, task: string, prompt: string, inputs: StepReport[], announce: boolean): Promise<StepReport> {
    if (announce) {
      for (const input of inputs) this.emitStep(ctx, stepId, agent.info.id, { type: "step.handoff", data: { from: input.id, to: stepId, summary: input.summary.slice(0, 1500) } });
    }
    const outcome = await this.runStep(ctx, stepId, agent, task, prompt, { budgetUsd: this.stepBudget(ctx, agent), announce });
    const report: StepReport = {
      id: stepId,
      agentName: agent.info.name,
      status: outcome.ok ? "succeeded" : "failed",
      summary: outcome.ok ? extractSummary(outcome.text) : `failed: ${outcome.error ?? "unknown error"}`,
      report: outcome.text,
    };
    if (outcome.text && this.running(ctx)) {
      const rel = `${REPORTS_DIR}/${stepId}-${agent.info.id}.md`;
      await writeFile(path.join(ctx.workspace, rel), outcome.text, "utf8");
      const bytes = Buffer.byteLength(outcome.text);
      const id = randomUUID();
      const title = `${agent.info.name} report`;
      this.store.recordArtifact({ id, runId: ctx.runId, stepId, title, path: rel, bytes });
      this.emitStep(ctx, stepId, agent.info.id, { type: "artifact.created", data: { id, title, path: rel, bytes } });
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
    opts: { budgetUsd: number; outputSchema?: Record<string, unknown>; announce?: boolean },
  ): Promise<SessionOutcome> {
    const controller = new AbortController();
    ctx.controllers.add(controller);
    if (opts.announce !== false) this.emitStep(ctx, stepId, agent.info.id, { type: "step.ready", data: { task } });
    const skills = this.deps.skills && agent.skills.length > 0 ? this.deps.skills.materialize(agent.skills, ctx.workspace) : [];
    const mcp = this.deps.integrations && agent.integrations.length > 0 ? this.deps.integrations.forAgent(agent.integrations) : undefined;
    if (mcp && mcp.unavailable.length > 0) {
      this.emitStep(ctx, stepId, agent.info.id, { type: "step.message", data: { messageId: randomUUID(), role: "system", partial: false, text: `Integrations not available (missing config or secrets): ${mcp.unavailable.join(", ")}` } });
    }
    try {
      const outcome = await this.runSession({
        agent,
        prompt,
        task,
        workspace: ctx.workspace,
        model: ctx.profile.models[agent.info.modelClass],
        budgetUsd: opts.budgetUsd,
        env: ctx.env,
        controller,
        emit: (event) => this.emitStep(ctx, stepId, agent.info.id, event),
        authorize: (tool, input) => this.authorize(ctx, stepId, agent, tool, input, mcp?.allows ?? (() => false)),
        outputSchema: opts.outputSchema,
        skills,
        mcpServers: mcp?.servers,
        osSandbox: this.config.osSandbox,
        claudeCodePath: this.config.claudeCodePath,
      });
      ctx.spentUsd += outcome.costUsd ?? 0;
      ctx.stepCost.set(stepId, (ctx.stepCost.get(stepId) ?? 0) + (outcome.costUsd ?? 0));
      ctx.numTurns += outcome.numTurns;
      this.checkBudget(ctx);
      return outcome;
    } finally {
      ctx.controllers.delete(controller);
    }
  }

  private async authorize(
    ctx: RunContext,
    stepId: string,
    agent: AgentDefinition,
    tool: string,
    input: Record<string, unknown>,
    mcpAllowed: (tool: string) => boolean,
  ): Promise<Authorization> {
    const gate = evaluate(
      {
        mode: ctx.approvalMode,
        workspace: ctx.workspace,
        agentName: agent.info.name,
        agentTools: agent.tools,
        mcpAllowed,
        requiresApproval: agent.requiresApproval,
        neverAuto: this.config.neverAuto,
        approvedForRun: ctx.approvedForRun,
      },
      tool,
      input,
    );
    const emit = (event: EventData) => this.emitStep(ctx, stepId, agent.info.id, event);
    if (gate.kind === "deny") {
      emit({ type: "tool.denied", data: { tool, reason: gate.reason } });
      return { allow: false, reason: gate.reason };
    }
    if (gate.kind === "allow") {
      if (gate.by) emit({ type: "step.approved", data: { approvalId: randomUUID(), by: gate.by, scope: "once", tool, reason: gate.reason ?? "" } });
      return { allow: true };
    }

    const approvalId = randomUUID();
    this.store.recordApproval({ id: approvalId, runId: ctx.runId, stepId, kind: "tool", request: { tool, input, reason: gate.reason } });
    emit({ type: "step.approval_requested", data: { approvalId, tool, input, reason: gate.reason } });
    const d = await this.waitForDecision(ctx, approvalId, "tool");
    this.store.decideApproval(approvalId, d.decision, "user", d.note);
    if (d.decision === "reject") {
      emit({ type: "step.rejected", data: { approvalId, by: "user", note: d.note } });
      return { allow: false, reason: `The owner rejected this action${d.note ? `: ${d.note}` : ""}. Find another way or report it.` };
    }
    if (d.decision === "approve_run" && !gate.neverAuto) ctx.approvedForRun.add(tool);
    emit({ type: "step.approved", data: { approvalId, by: "user", scope: d.decision === "approve_run" ? "run" : "once", tool, reason: gate.reason } });
    return { allow: true };
  }

  private waitForDecision(ctx: RunContext, approvalId: string, kind: "tool" | "plan") {
    return new Promise<{ decision: "approve" | "approve_run" | "reject"; note: string }>((resolve) => {
      if (!this.running(ctx)) return resolve({ decision: "reject", note: "run ended" });
      ctx.pending.set(approvalId, {
        kind,
        resolve: (d) => {
          ctx.pending.delete(approvalId);
          resolve(d);
        },
      });
    });
  }

  private async waitIfPaused(ctx: RunContext) {
    while (ctx.paused && this.running(ctx)) {
      await new Promise<void>((resolve) => ctx.resumeWaiters.push(resolve));
    }
  }

  private wake(ctx: RunContext) {
    const waiters = ctx.resumeWaiters.splice(0);
    for (const w of waiters) w();
  }

  private stepBudget(ctx: RunContext, agent: AgentDefinition): number {
    return Math.min(agent.limits.maxBudgetUsd, ctx.profile.budgetUsd - ctx.spentUsd - FINAL_RESERVE_USD);
  }

  private checkBudget(ctx: RunContext) {
    const limit = ctx.profile.budgetUsd;
    if (!ctx.warned && ctx.spentUsd >= limit * 0.8) {
      ctx.warned = true;
      this.emitRun(ctx, { type: "budget.warning", data: { spentUsd: round(ctx.spentUsd), limitUsd: limit } });
    }
  }

  private budgetExceeded(ctx: RunContext) {
    if (ctx.exceeded) return;
    ctx.exceeded = true;
    this.emitRun(ctx, { type: "budget.exceeded", data: { spentUsd: round(ctx.spentUsd), limitUsd: ctx.profile.budgetUsd } });
  }

  private complete(ctx: RunContext, answer: string) {
    if (this.running(ctx)) this.deps.memory?.remember(ctx.runId, ctx.prompt, answer);
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
      // Step cost includes earlier attempts (retries, CEO reviews); run total = finished sessions + this one.
      const base = ctx.stepCost.get(stepId) ?? 0;
      const cost = event.data.costUsd ?? null;
      event = {
        ...event,
        data: { ...event.data, costUsd: cost === null ? null : round(base + cost), runCostUsd: round(ctx.spentUsd + (cost ?? 0)) },
      };
    }
    this.store.append(ctx.runId, event, { stepId, agentId });
  }
}

export function buildStepPrompt(request: string, step: { id: string; task: string; successCriteria?: string }, inputs: StepReport[], notes = ""): string {
  const sections = [
    ...(notes ? [`# ${notes}`] : []),
    `# Client request\n${request}`,
    `# Your task (step ${step.id})\n${step.task}${step.successCriteria ? `\n\nSuccess criteria: ${step.successCriteria}` : ""}`,
  ];
  if (inputs.length > 0) {
    sections.push(
      `# Input from earlier steps\n${inputs
        .map((i) => `## ${i.id} · ${i.agentName}${i.status !== "succeeded" ? ` (${i.status})` : ""}\n${i.summary}${i.reportPath ? `\n(Full report: ${i.reportPath})` : ""}`)
        .join("\n\n")}`,
    );
  }
  return sections.join("\n\n");
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
