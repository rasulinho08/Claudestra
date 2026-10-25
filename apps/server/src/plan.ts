// CEO planning: prompt building, decision parsing and plan validation (docs/03 "CEO behaviour").
import { z } from "zod";
import { CEO_FINAL_STEP, CEO_PLAN_STEP, CeoDecision, type Plan } from "@claudestra/protocol";
import type { AgentDefinition } from "./agents.ts";

// JSON schema the SDK enforces on the CEO's planning reply. The CLI's validator does not know
// the draft 2020-12 meta-schema URL, so the "$schema" key is dropped.
const { $schema: _meta, ...decisionSchema } = z.toJSONSchema(CeoDecision, { target: "draft-7" }) as Record<string, unknown>;
export const ceoDecisionSchema: Record<string, unknown> = decisionSchema;

export function buildPlanningPrompt(request: string, roster: AgentDefinition[], planSizeCap: number, budgetUsd: number): string {
  const agents = roster
    .map((a) => `- ${a.info.id} (${a.info.name}, cost: ${a.info.modelClass}): ${a.info.description}`)
    .join("\n");
  return `MODE: PLANNING

Roster (the only agents you may use):
${agents}

Limits: at most ${planSizeCap} steps; run budget $${budgetUsd.toFixed(2)}.

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
  const steps = decision.steps.map((s) => ({ ...s, dependsOn: [...new Set(s.dependsOn)], successCriteria: s.successCriteria }));
  if (steps.length === 0) throw new Error(`${decision.route} route without steps`);
  if (steps.length > planSizeCap) throw new Error(`plan has ${steps.length} steps; the cap is ${planSizeCap}`);
  if (decision.route === "single_agent" && steps.length !== 1) throw new Error("single_agent route must have exactly one step");

  const ids = new Set<string>();
  for (const step of steps) {
    if (step.id === CEO_PLAN_STEP || step.id === CEO_FINAL_STEP) throw new Error(`step id "${step.id}" is reserved`);
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
  return { route: decision.route, summary: decision.summary, steps };
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
