// Loads agent definitions from agents/*.md (YAML frontmatter + system prompt body, docs/03).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  // A person's name for this agent (e.g. "Rasul Fateh") and how they work; both shape the prompt (training.ts).
  persona: z.string().max(60).optional(),
  style: z.string().max(600).optional(),
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
  style?: string;
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
    info: { id: fm.id, name: fm.name, description: fm.description, color: fm.color, icon: fm.icon, modelClass: fm.modelClass, ...(fm.persona ? { persona: fm.persona } : {}) },
    style: fm.style,
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
  // Which folder each agent's file lives in (agents/ or the git-ignored team/agents/ for people's own agents).
  private homes = new Map<string, string>();
  private dirs: string[];

  constructor(definitions: AgentDefinition[], private dir?: string, extraDirs: string[] = []) {
    this.dirs = dir ? [dir, ...extraDirs] : [];
    this.load(definitions);
  }

  // agents/ first, then extra folders (team/agents/): personal agents stay out of the public repository.
  static fromDir(dir: string, extraDirs: string[] = []): AgentRegistry {
    const reg = new AgentRegistry([], dir, extraDirs.filter((d) => existsSync(d)));
    reg.reload();
    return reg;
  }

  private static readDir(dir: string): { def: AgentDefinition; dir: string }[] {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    return files.map((f) => ({ def: parseAgent(readFileSync(path.join(dir, f), "utf8"), f), dir }));
  }

  private reload() {
    const all = this.dirs.flatMap((d) => AgentRegistry.readDir(d));
    this.homes = new Map(all.map((x) => [x.def.info.id, x.dir]));
    this.load(all.map((x) => x.def));
  }

  private load(definitions: AgentDefinition[]) {
    if (definitions.length === 0 && this.dirs.length > 0) return; // filled by reload()
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
    const home = this.homes.get(id) ?? this.dir;
    writeFileSync(path.join(home, `${id}.md`), source.endsWith("\n") ? source : `${source}\n`, "utf8");
    this.reload();
    return def;
  }

  // Rewrites only the `skills:` list in an agent's frontmatter (keeps comments and the rest of the file).
  setSkills(id: string, skills: string[]): AgentDefinition {
    const def = this.agents.get(id);
    if (!def) throw new Error(`unknown agent ${id}`);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n?[\s\S]*)$/.exec(def.source);
    if (!match) throw new Error(`${id}.md: missing YAML frontmatter`);
    for (const s of skills) if (!/^[a-z0-9-]{1,64}$/.test(s)) throw new Error(`bad skill name ${s}`);
    // Text edit, not a YAML round trip, so quoting, comments and line wrapping stay exactly as written.
    const line = `skills: [${[...new Set(skills)].join(", ")}]`;
    const fm = match[1]!;
    const existing = /^skills:[^\n]*(?:\r?\n[ \t]+-[^\n]*)*/m;
    const next = existing.test(fm) ? fm.replace(existing, line) : /^limits:/m.test(fm) ? fm.replace(/^limits:/m, `${line}\nlimits:`) : `${fm}\n${line}`;
    return this.save(id, `---\n${next}\n---${match[2]}`);
  }

  // Sets or clears persona/style lines in the frontmatter (text edit, keeps the rest of the file).
  setPersona(id: string, persona: string, style: string): AgentDefinition {
    const def = this.agents.get(id);
    if (!def) throw new Error(`unknown agent ${id}`);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n?[\s\S]*)$/.exec(def.source);
    if (!match) throw new Error(`${id}.md: missing YAML frontmatter`);
    const q = (v: string) => JSON.stringify(v.replace(/[\r\n]+/g, " ").trim());
    let fm = match[1]!;
    // Style first, then persona: both insert right after "name:", so the file reads name, persona, style.
    for (const [key, value, max] of [["style", style, 600], ["persona", persona, 60]] as const) {
      const re = new RegExp(`^${key}:.*$`, "m");
      const v = value.trim().slice(0, max);
      if (!v) fm = fm.replace(new RegExp(`^${key}:.*\\r?\\n?`, "m"), "");
      else fm = re.test(fm) ? fm.replace(re, `${key}: ${q(v)}`) : fm.replace(/^(name:.*)$/m, `$1\n${key}: ${q(v)}`);
    }
    return this.save(id, `---\n${fm}\n---${match[2]}`);
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
