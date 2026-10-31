// Starting runs, shared by the HTTP API, triggers and evals (docs/04).
import { randomUUID } from "node:crypto";
import type { AnswerLanguage, ApprovalMode, Profile } from "@claudestra/protocol";
import type { Config } from "./config.ts";
import type { RunStore } from "./store.ts";
import type { AgentRegistry } from "./agents.ts";
import type { WorkflowStore } from "./workflows.ts";
import type { StartOptions } from "./orchestrator.ts";
import { resolveSdkAuth } from "./auth.ts";
import { startOfDay, startOfMonth } from "./analytics.ts";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ProjectError, type Projects } from "./projects.ts";

export class HttpError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 429, message: string) {
    super(message);
  }
}

export type RunRequest = {
  prompt: string;
  profile?: Profile;
  approvalMode?: ApprovalMode;
  workflowId?: string;
  params?: Record<string, string>;
  language?: AnswerLanguage;
  projectId?: string;
  createdBy?: string;
  // Who started it: "user", "trigger:<id>", "eval:<id>".
  origin?: string;
};

export type Starter = { start(runId: string, opts: StartOptions): Promise<void> };

export class RunLauncher {
  constructor(
    private config: Config,
    private store: RunStore,
    private agents: AgentRegistry,
    private workflows: WorkflowStore,
    private runner: Starter,
    private projects?: Projects,
  ) {}

  start(req: RunRequest): { runId: string } {
    const auth = resolveSdkAuth(this.config.authMode, process.env);
    if (!auth.ok) throw new HttpError(409, auth.reason);
    // Daily / monthly caps (docs/11 §2.3) are checked before any spend.
    if (this.config.dailyBudgetUsd !== null && this.store.spentSince(startOfDay()) >= this.config.dailyBudgetUsd) {
      throw new HttpError(429, `Daily budget of $${this.config.dailyBudgetUsd} reached`);
    }
    if (this.config.monthlyBudgetUsd !== null && this.store.spentSince(startOfMonth()) >= this.config.monthlyBudgetUsd) {
      throw new HttpError(429, `Monthly budget of $${this.config.monthlyBudgetUsd} reached`);
    }

    const profile = req.profile ?? this.config.defaultProfile;
    const approvalMode = req.approvalMode ?? this.config.defaultApprovalMode;
    let prompt = req.prompt.trim();
    let plan: StartOptions["plan"];
    if (req.workflowId) {
      const wf = this.workflows.get(req.workflowId);
      if (!wf) throw new HttpError(404, "workflow not found");
      try {
        ({ prompt, plan } = this.workflows.instantiate(wf, { prompt, ...(req.params ?? {}) }));
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      const unknown = plan.steps.find((st) => !this.agents.get(st.agent) || st.agent === "ceo");
      if (unknown) throw new HttpError(400, `workflow uses unknown agent "${unknown.agent}"`);
    }
    if (!prompt) throw new HttpError(400, "prompt is required");

    const runId = randomUUID();
    // Project runs start from a copy of the project's files (projects.ts).
    let projectNote = "";
    const project = req.projectId ? this.projects?.get(req.projectId) : undefined;
    if (req.projectId && !project) throw new HttpError(404, "project not found");
    if (project && this.projects) {
      const workspace = path.join(this.config.workspacesDir, runId);
      mkdirSync(workspace, { recursive: true });
      try {
        projectNote = this.projects.prepareRun(project.id, runId, workspace);
      } catch (err) {
        rmSync(workspace, { recursive: true, force: true });
        if (err instanceof ProjectError) throw new HttpError(err.status, err.message);
        throw err;
      }
    }
    this.store.create({ id: runId, prompt, source: "claudestra", createdBy: req.createdBy, origin: req.origin });
    this.store.append(runId, {
      type: "run.started",
      data: {
        prompt,
        source: "claudestra",
        authMode: this.config.authMode,
        budgetUsd: this.config.profiles[profile].budgetUsd,
        agents: this.agents.infos(),
        profile,
        approvalMode,
        mode: plan ? "workflow" : "dynamic",
        workflowId: req.workflowId,
        origin: req.origin ?? "user",
        createdBy: req.createdBy,
        language: req.language ?? "auto",
        ...(project ? { project: { id: project.id, name: project.name } } : {}),
      },
    });
    this.runner.start(runId, { prompt, profile, approvalMode, plan, language: req.language ?? "auto", projectNote }).catch((err: unknown) => {
      if (this.store.status(runId) === "running") this.store.append(runId, { type: "run.failed", data: { error: err instanceof Error ? err.message : String(err) } });
    });
    return { runId };
  }

  // Resolves when the run reaches a terminal state (used by evals).
  waitForEnd(runId: string, timeoutMs: number): Promise<"completed" | "failed" | "cancelled" | "timeout"> {
    return new Promise((resolve) => {
      const done = () => {
        const s = this.store.status(runId);
        return s && s !== "running" ? s : null;
      };
      const now = done();
      if (now) return resolve(now);
      const timer = setTimeout(() => {
        unsubscribe();
        resolve("timeout");
      }, timeoutMs);
      const unsubscribe = this.store.subscribe(runId, () => {
        const s = done();
        if (!s) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(s);
      });
    });
  }
}
