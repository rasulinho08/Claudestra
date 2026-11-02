// Per-agent training (docs/03 "Training"): every agent has its own instructions from the owner and lessons from
// rated work (👍 keep doing / 👎 avoid). They are added to that agent's system prompt only, so each agent learns
// separately. No model calls; plain text the owner can read and delete.
import { randomUUID } from "node:crypto";
import type { RunStore } from "./store.ts";
import type { AgentDefinition } from "./agents.ts";

export type TrainingItem = {
  id: string;
  agentId: string;
  kind: "instruction" | "lesson";
  rating: "up" | "down" | null;
  text: string;
  runId: string | null;
  stepId: string | null;
  createdAt: string;
};

const MAX_TEXT = 1000;
const MAX_BLOCK = 3000;
const MAX_LESSONS = 15;

export class Training {
  constructor(private store: RunStore) {
    store.database.exec(`CREATE TABLE IF NOT EXISTS agent_training (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, kind TEXT NOT NULL, rating TEXT, text TEXT NOT NULL,
      run_id TEXT, step_id TEXT, created_at TEXT NOT NULL)`);
  }

  list(agentId: string): TrainingItem[] {
    return (
      this.store.database.prepare("SELECT * FROM agent_training WHERE agent_id = ? ORDER BY created_at DESC").all(agentId) as {
        id: string;
        agent_id: string;
        kind: "instruction" | "lesson";
        rating: "up" | "down" | null;
        text: string;
        run_id: string | null;
        step_id: string | null;
        created_at: string;
      }[]
    ).map((r) => ({ id: r.id, agentId: r.agent_id, kind: r.kind, rating: r.rating, text: r.text, runId: r.run_id, stepId: r.step_id, createdAt: r.created_at }));
  }

  counts(): Record<string, number> {
    const rows = this.store.database.prepare("SELECT agent_id, COUNT(*) AS n FROM agent_training GROUP BY agent_id").all() as { agent_id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.agent_id, r.n]));
  }

  add(agentId: string, item: { kind: "instruction" | "lesson"; text: string; rating?: "up" | "down" | null; runId?: string; stepId?: string }): TrainingItem {
    const text = item.text.trim().slice(0, MAX_TEXT);
    if (!text) throw new Error("write what the agent should learn");
    const row: TrainingItem = {
      id: randomUUID(),
      agentId,
      kind: item.kind,
      rating: item.kind === "lesson" ? (item.rating ?? null) : null,
      text,
      runId: item.runId ?? null,
      stepId: item.stepId ?? null,
      createdAt: new Date().toISOString(),
    };
    this.store.database
      .prepare("INSERT INTO agent_training (id, agent_id, kind, rating, text, run_id, step_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.agentId, row.kind, row.rating, row.text, row.runId, row.stepId, row.createdAt);
    return row;
  }

  remove(agentId: string, id: string): boolean {
    return Number(this.store.database.prepare("DELETE FROM agent_training WHERE id = ? AND agent_id = ?").run(id, agentId).changes) > 0;
  }

  // The text added to this agent's system prompt: all instructions, then the newest lessons.
  block(agentId: string): string {
    const items = this.list(agentId);
    const instructions = items.filter((i) => i.kind === "instruction").reverse();
    const lessons = items.filter((i) => i.kind === "lesson").slice(0, MAX_LESSONS);
    if (instructions.length === 0 && lessons.length === 0) return "";
    const parts = ["## Training from your owner (always follow it)"];
    if (instructions.length) parts.push(...instructions.map((i) => `- ${i.text}`));
    if (lessons.length) {
      parts.push("", "Lessons from your earlier work:");
      parts.push(...lessons.map((l) => `- ${l.rating === "up" ? "Keep doing" : l.rating === "down" ? "Avoid" : "Note"}: ${l.text}`));
    }
    const text = parts.join("\n");
    return text.length > MAX_BLOCK ? `${text.slice(0, MAX_BLOCK)}\n…` : text;
  }
}

// Identity block from the agent's frontmatter (persona name and working style).
export function personaBlock(agent: AgentDefinition): string {
  if (!agent.info.persona && !agent.style) return "";
  const who = agent.info.persona ? `Your name is ${agent.info.persona}; you are the company's ${agent.info.name}.` : "";
  return [who, agent.style ? `Your working style: ${agent.style}` : ""].filter(Boolean).join(" ");
}

// System prompt for one step: identity, the agent file's prompt, then its training.
export function trainedPrompt(agent: AgentDefinition, training?: Training): string {
  return [personaBlock(agent), agent.systemPrompt, training?.block(agent.info.id) ?? ""].filter(Boolean).join("\n\n");
}
