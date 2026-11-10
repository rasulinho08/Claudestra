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
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ProjectError, type Projects } from "./projects.ts";
import { UploadError, Uploads, attachmentNote } from "./uploads.ts";

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
  // Straight to one agent ("my agent"), no CEO planning.
  agentId?: string;
  // Chat (chat.ts): earlier turns of the conversation, and the run whose files this one continues from.
  history?: string;
  seedFrom?: string;
  // Attachments (uploads.ts) to copy into the workspace.
  uploadId?: string;
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
    private uploads: Uploads = new Uploads(config.uploadsDir),
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
    if (req.agentId && !req.workflowId) {
      const target = this.agents.get(req.agentId);
      if (!target || req.agentId === "ceo") throw new HttpError(404, "agent not found");
      plan = {
        route: "single_agent",
        summary: `Direct task for ${target.info.persona || target.info.name}`,
        steps: [{ id: "s1", agent: target.info.id, task: prompt, dependsOn: [], successCriteria: "", loopBackTo: "" }],
      };
    }

    const runId = randomUUID();
    // Project runs start from a copy of the project's files (projects.ts).
    let projectNote = "";
    const project = req.projectId ? this.projects?.get(req.projectId) : undefined;
    if (req.projectId && !project) throw new HttpError(404, "project not found");
    // A chat turn continues in a copy of the previous turn's files (not when a project supplies them).
    if (!project && req.seedFrom && /^[A-Za-z0-9-]{1,128}$/.test(req.seedFrom)) {
      const from = path.join(this.config.workspacesDir, req.seedFrom);
      if (existsSync(from)) {
        cpSync(from, path.join(this.config.workspacesDir, runId), {
          recursive: true,
          filter: (src) => !path.relative(from, src).split(path.sep).some((seg) => [".claudestra", ".claude", "node_modules", ".git"].includes(seg)),
        });
      }
    }
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
    // Attachments go to inputs/ (inside .claudestra/ for project runs, so they are not offered as project changes).
    let filesNote = "";
    if (req.uploadId) {
      const workspace = path.join(this.config.workspacesDir, runId);
      const sub = project ? ".claudestra/inputs" : "inputs";
      try {
        mkdirSync(workspace, { recursive: true });
        filesNote = attachmentNote(sub, this.uploads.attach(req.uploadId, workspace, sub, req.createdBy ?? null));
      } catch (err) {
        rmSync(workspace, { recursive: true, force: true });
        if (err instanceof UploadError) throw new HttpError(400, err.message);
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
        mode: req.agentId && !req.workflowId ? "direct" : plan ? "workflow" : "dynamic",
        workflowId: req.workflowId,
        origin: req.origin ?? "user",
        createdBy: req.createdBy,
        language: req.language ?? "auto",
        ...(project ? { project: { id: project.id, name: project.name } } : {}),
      },
    });
    const contextNote = [projectNote, filesNote, req.history ?? ""].filter(Boolean).join("\n\n");
    this.runner.start(runId, { prompt, profile, approvalMode, plan, language: req.language ?? "auto", projectNote: contextNote }).catch((err: unknown) => {
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
