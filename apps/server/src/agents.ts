// Loads agent definitions from agents/*.md (YAML frontmatter + system prompt body, docs/03).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  // Tool patterns ("Tool" or "Tool:argGlob") that need approval in manual/smart mode (docs/05 "Permission model").
  requiresApproval: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  // MCP tools this agent may use: "server" (all tools) or "server:toolGlob".
  integrations: z.array(z.string()).default([]),
  limits: z.object({ maxTurns: z.number().int().positive(), maxBudgetUsd: z.number().positive() }),
  color: z.string().default("#8a92a6"),
  icon: z.string().default("bot"),
});

export type AgentDefinition = {
  info: AgentInfo;
  tools: string[];
  requiresApproval: string[];
  skills: string[];
  integrations: string[];
  limits: { maxTurns: number; maxBudgetUsd: number };
  systemPrompt: string;
  source: string;
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
    requiresApproval: fm.requiresApproval,
    skills: fm.skills,
    integrations: fm.integrations,
    limits: fm.limits,
    systemPrompt,
    source,
  };
}

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  constructor(definitions: AgentDefinition[], private dir?: string) {
    this.load(definitions);
  }

  static fromDir(dir: string): AgentRegistry {
    return new AgentRegistry(AgentRegistry.readDir(dir), dir);
  }

  private static readDir(dir: string): AgentDefinition[] {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    return files.map((f) => parseAgent(readFileSync(path.join(dir, f), "utf8"), f));
  }

  private load(definitions: AgentDefinition[]) {
    const next = new Map<string, AgentDefinition>();
    for (const def of definitions) {
      if (next.has(def.info.id)) throw new Error(`duplicate agent id ${def.info.id}`);
      next.set(def.info.id, def);
    }
    if (!next.has("ceo")) throw new Error("agents/ceo.md is required");
    this.agents = next;
  }

  // Validates and writes an agent file, then reloads. Running steps keep the definition they started with.
  save(id: string, source: string): AgentDefinition {
    if (!this.dir) throw new Error("registry has no agents directory");
    const def = parseAgent(source, `${id}.md`);
    if (def.info.id !== id) throw new Error(`frontmatter id "${def.info.id}" does not match "${id}"`);
    if (id === "ceo" && def.tools.length > 0) throw new Error("the CEO must not have tools");
    writeFileSync(path.join(this.dir, `${id}.md`), source.endsWith("\n") ? source : `${source}\n`, "utf8");
    this.load(AgentRegistry.readDir(this.dir));
    return def;
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

  all(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  infos(): AgentInfo[] {
    return this.all().map((a) => a.info);
  }
}
