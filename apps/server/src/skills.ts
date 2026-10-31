// Skill library (docs/05 "Skills"): skills/<name>/SKILL.md folders, copied into a step's workspace
// (.claude/skills/<name>) only for the agents that use them. The SDK loads the body lazily.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type SkillInfo = { name: string; description: string; usedBy: string[] };

export class SkillLibrary {
  constructor(private dir: string) {}

  list(agents: { id: string; skills: string[] }[] = []): SkillInfo[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(this.dir, d.name, "SKILL.md")))
      .map((d) => {
        const source = readFileSync(path.join(this.dir, d.name, "SKILL.md"), "utf8");
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
        let description = "";
        try {
          description = String(((fm ? parseYaml(fm[1]!) : null) as { description?: string } | null)?.description ?? "");
        } catch {
          // Not strict YAML (e.g. an unquoted colon in the description): read the line as text.
          description = /^description:\s*(.*)$/m.exec(fm?.[1] ?? "")?.[1]?.replace(/^["']|["']$/g, "") ?? "";
        }
        return { name: d.name, description, usedBy: agents.filter((a) => a.skills.includes(d.name)).map((a) => a.id) };
      });
  }

  read(name: string): string {
    this.assertName(name);
    return readFileSync(path.join(this.dir, name, "SKILL.md"), "utf8");
  }

  save(name: string, source: string) {
    this.assertName(name);
    if (!/^---\r?\n[\s\S]*?description:[\s\S]*?\r?\n---/.test(source)) throw new Error("SKILL.md needs frontmatter with a description");
    mkdirSync(path.join(this.dir, name), { recursive: true });
    writeFileSync(path.join(this.dir, name, "SKILL.md"), source, "utf8");
  }

  get directory(): string {
    return this.dir;
  }

  remove(name: string) {
    this.assertName(name);
    const dir = path.join(this.dir, name);
    if (!existsSync(path.join(dir, "SKILL.md"))) throw new Error(`no skill named ${name}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // Copies the named skills into the workspace and returns the ones that exist.
  materialize(names: string[], workspace: string): string[] {
    const present: string[] = [];
    for (const name of names) {
      const src = path.join(this.dir, name);
      if (!/^[a-z0-9-]+$/.test(name) || !existsSync(path.join(src, "SKILL.md"))) continue;
      cpSync(src, path.join(workspace, ".claude", "skills", name), { recursive: true });
      present.push(name);
    }
    return present;
  }

  private assertName(name: string) {
    if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error("skill names are lowercase letters, digits and dashes");
  }
}
