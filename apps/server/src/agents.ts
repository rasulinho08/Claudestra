// Loads agent definitions from agents/*.md (YAML frontmatter + system prompt body, docs/03).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ModelClass, type AgentInfo } from "@claudestra/protocol";

const Frontmatter = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string(),
  description: z.string(),
  modelClass: ModelClass,
  tools: z.array(z.string()).default([]),
  limits: z.object({ maxTurns: z.number().int().positive(), maxBudgetUsd: z.number().positive() }),
  color: z.string().default("#8a92a6"),
  icon: z.string().default("bot"),
});

export type AgentDefinition = {
  info: AgentInfo;
  tools: string[];
  limits: { maxTurns: number; maxBudgetUsd: number };
  systemPrompt: string;
};

export function parseAgent(source: string, file = "agent"): AgentDefinition {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  const result = Frontmatter.safeParse(parseYaml(match[1]!));
  if (!result.success) throw new Error(`${file}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const fm = result.data;
  const systemPrompt = match[2]!.trim();
  if (!systemPrompt) throw new Error(`${file}: empty system prompt`);
  return {
    info: { id: fm.id, name: fm.name, description: fm.description, color: fm.color, icon: fm.icon, modelClass: fm.modelClass },
    tools: fm.tools,
    limits: fm.limits,
    systemPrompt,
  };
}

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  constructor(definitions: AgentDefinition[]) {
    for (const def of definitions) {
      if (this.agents.has(def.info.id)) throw new Error(`duplicate agent id ${def.info.id}`);
      this.agents.set(def.info.id, def);
    }
    if (!this.agents.has("ceo")) throw new Error("agents/ceo.md is required");
  }

  static fromDir(dir: string): AgentRegistry {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    return new AgentRegistry(files.map((f) => parseAgent(readFileSync(path.join(dir, f), "utf8"), f)));
  }

  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  ceo(): AgentDefinition {
    return this.agents.get("ceo")!;
  }

  // Specialists the CEO may plan with.
  specialists(): AgentDefinition[] {
    return [...this.agents.values()].filter((a) => a.info.id !== "ceo");
  }

  infos(): AgentInfo[] {
    return [...this.agents.values()].map((a) => a.info);
  }
}
