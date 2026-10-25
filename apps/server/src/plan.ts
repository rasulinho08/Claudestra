// CEO planning: prompt building, decision parsing and plan validation (docs/03 "CEO behaviour").
import { z } from "zod";
import { CEO_FINAL_STEP, CEO_PLAN_STEP, CeoDecision, CeoReview, type Plan, type PlannedStep } from "@claudestra/protocol";
import type { AgentDefinition } from "./agents.ts";

// JSON schema the SDK enforces on the CEO's planning reply. The CLI's validator does not know
// the draft 2020-12 meta-schema URL, so the "$schema" key is dropped.
const { $schema: _meta, ...decisionSchema } = z.toJSONSchema(CeoDecision, { target: "draft-7" }) as Record<string, unknown>;
export const ceoDecisionSchema: Record<string, unknown> = decisionSchema;
const { $schema: _reviewMeta, ...reviewSchema } = z.toJSONSchema(CeoReview, { target: "draft-7" }) as Record<string, unknown>;
export const ceoReviewSchema: Record<string, unknown> = reviewSchema;

// Verifier reports start with "VERDICT: APPROVE" or "VERDICT: CHANGES REQUESTED" (agents/reviewer.md).
export function verdictOf(report: string): "approve" | "changes" | "unknown" {
  const m = /VERDICT:\s*\**\s*(APPROVE|CHANGES REQUESTED)/i.exec(report);
  if (m) return m[1]!.toUpperCase() === "APPROVE" ? "approve" : "changes";
  return /CHANGES REQUESTED/i.test(report) ? "changes" : "unknown";
}

export function buildPlanningPrompt(request: string, roster: AgentDefinition[], planSizeCap: number, budgetUsd: number): string {
  const agents = roster
    .map((a) => `- ${a.info.id} (${a.info.name}, cost: ${a.info.modelClass}): ${a.info.description}`)
    .join("\n");
  return `MODE: PLANNING

Roster (the only agents you may use):
${agents}

Limits: at most ${planSizeCap} steps; run budget $${budgetUsd.toFixed(2)}. Cheaper agents and fewer steps are better when they are enough.

Client request:
<request>
${request}
</request>

Return your decision as JSON matching the schema.`;
}

export type StepReport = { id: string; agentName: string; status: string; summary: string; report: string; reportPath?: string };

export function buildFinalPrompt(request: string, plan: Plan, reports: StepReport[]): string {
  const body = reports
    .map((r) => `## ${r.id} · ${r.agentName} · ${r.status}\n${r.report.slice(0, 4000) || r.summary || "(no output)"}`)
    .join("\n\n");
  return `MODE: FINALIZING

Client request:
<request>
${request}
</request>

Plan summary: ${plan.summary}

Step reports:
${body}

Write the final answer for the client.`;
}

export function buildReviewPrompt(request: string, plan: Plan, step: PlannedStep, error: string, attempts: number, remainingUsd: number): string {
  return `MODE: REVIEWING

Client request:
<request>
${request}
</request>

Plan summary: ${plan.summary}
Failed step ${step.id} (${step.agent}), attempt ${attempts}: ${step.task}
Error: ${error.slice(0, 1500)}
Budget left: $${remainingUsd.toFixed(2)}

Decide what to do with this failure. Return JSON matching the schema.`;
}

// Fills {{name}} placeholders of a saved workflow (docs/04 "Workflow").
export function fillTemplate(text: string, params: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) => params[key] ?? whole);
}

// Pulls the JSON decision out of a reply when structured output is unavailable.
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in CEO reply");
  return JSON.parse(text.slice(start, end + 1));
}

export function validatePlan(raw: unknown, roster: AgentDefinition[], planSizeCap: number): Plan {
  const decision = CeoDecision.parse(raw);
  if (decision.route === "direct") {
    if (!decision.directAnswer.trim()) throw new Error("direct route without an answer");
    return { route: "direct", summary: decision.summary, steps: [] };
  }
  const known = new Set(roster.map((a) => a.info.id));
  const steps = decision.steps.map((s) => ({ ...s, dependsOn: [...new Set(s.dependsOn)] }));
  if (steps.length === 0) throw new Error(`${decision.route} route without steps`);
  if (steps.length > planSizeCap) throw new Error(`plan has ${steps.length} steps; the cap is ${planSizeCap}`);
  if (decision.route === "single_agent" && steps.length !== 1) throw new Error("single_agent route must have exactly one step");

  const ids = new Set<string>();
  for (const step of steps) {
    if (step.id === CEO_PLAN_STEP || step.id === CEO_FINAL_STEP || /-r\d+$/.test(step.id)) throw new Error(`step id "${step.id}" is reserved`);
    if (ids.has(step.id)) throw new Error(`duplicate step id "${step.id}"`);
    if (!known.has(step.agent)) throw new Error(`step ${step.id} uses unknown agent "${step.agent}"`);
    ids.add(step.id);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) throw new Error(`step ${step.id} depends on unknown step "${dep}"`);
      if (dep === step.id) throw new Error(`step ${step.id} depends on itself`);
    }
  }
  assertAcyclic(steps);
  for (const step of steps) {
    if (!step.loopBackTo) continue;
    if (!ancestors(steps, step.id).has(step.loopBackTo)) throw new Error(`step ${step.id} loops back to ${step.loopBackTo}, which it does not depend on`);
  }
  return { route: decision.route, summary: decision.summary, steps };
}

function ancestors(steps: { id: string; dependsOn: string[] }[], id: string): Set<string> {
  const deps = new Map(steps.map((s) => [s.id, s.dependsOn]));
  const seen = new Set<string>();
  const walk = (x: string) => {
    for (const d of deps.get(x) ?? []) if (!seen.has(d)) (seen.add(d), walk(d));
  };
  walk(id);
  return seen;
}

function assertAcyclic(steps: { id: string; dependsOn: string[] }[]) {
  const deps = new Map(steps.map((s) => [s.id, s.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`plan has a dependency cycle at "${id}"`);
    state.set(id, "visiting");
    for (const dep of deps.get(id) ?? []) visit(dep);
    state.set(id, "done");
  };
  for (const s of steps) visit(s.id);
}

// The part of a report passed downstream: its "## Summary" section, else its tail.
export function extractSummary(report: string, limit = 1200): string {
  const match = /^#{1,3}\s*Summary\s*$/im.exec(report);
  const text = match ? report.slice(match.index + match[0].length).trim() : report.trim();
  if (text.length <= limit) return text;
  return match ? `${text.slice(0, limit)}…` : `…${text.slice(-limit)}`;
}
