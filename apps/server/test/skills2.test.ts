import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry } from "../src/agents.ts";
import { SkillLibrary } from "../src/skills.ts";
import { importSkill, parseGitHubUrl } from "../src/skill-import.ts";
import { declarationsFor, runLocalTool, skillCatalog } from "../src/local-tools.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("setSkills rewrites only the skills list and reloads the agent", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cls-agents-"));
  try {
    cpSync(path.join(root, "agents"), dir, { recursive: true });
    const reg = AgentRegistry.fromDir(dir);
    const before = readFileSync(path.join(dir, "coder.md"), "utf8");
    const def = reg.setSkills("coder", ["clean-code", "debugging-method", "clean-code"]);
    assert.deepEqual(def.skills, ["clean-code", "debugging-method"]);
    assert.deepEqual(reg.get("coder")!.skills, ["clean-code", "debugging-method"]);
    const after = readFileSync(path.join(dir, "coder.md"), "utf8");
    assert.equal(after.split("---")[2], before.split("---")[2], "system prompt untouched");
    assert.match(after, /requiresApproval: \[/);
    reg.setSkills("coder", []);
    assert.deepEqual(reg.get("coder")!.skills, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Skill tool on non-Claude engines: catalogue in the prompt, body on demand", async () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cls-skillws-"));
  try {
    const lib = new SkillLibrary(path.join(root, "skills"));
    assert.deepEqual(lib.materialize(["clean-code", "nope"], ws), ["clean-code"]);
    mkdirSync(path.join(ws, ".claude/skills/clean-code/ref"), { recursive: true });
    writeFileSync(path.join(ws, ".claude/skills/clean-code/ref/extra.md"), "x");
    assert.match(skillCatalog(ws, ["clean-code"]), /- clean-code: House rules/);
    assert.equal(skillCatalog(ws, []), "");
    assert.deepEqual(declarationsFor(["Read", "Nope"], ["clean-code"]).map((d) => d.name), ["Read", "Skill"]);
    assert.deepEqual(declarationsFor(["Read"], []).map((d) => d.name), ["Read"]);
    const loaded = await runLocalTool("Skill", { skill: "clean-code" }, ws, new AbortController().signal);
    assert.ok(loaded.ok);
    assert.match(loaded.output, /# Clean code rules/);
    assert.doesNotMatch(loaded.output, /^---/);
    assert.match(loaded.output, /\.claude\/skills\/clean-code\/ref\/extra\.md/);
    assert.equal((await runLocalTool("Skill", { skill: "../x" }, ws, new AbortController().signal)).ok, false);
    assert.equal((await runLocalTool("Skill", { skill: "missing" }, ws, new AbortController().signal)).ok, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("GitHub skill links parse; folders, blob links, raw files and repos", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/acme/skills/tree/main/pdf"), { owner: "acme", repo: "skills", ref: "main", path: "pdf" });
  assert.deepEqual(parseGitHubUrl("https://github.com/acme/skills/blob/main/pdf/SKILL.md"), { owner: "acme", repo: "skills", ref: "main", path: "pdf" });
  assert.deepEqual(parseGitHubUrl("https://github.com/acme/one-skill.git"), { owner: "acme", repo: "one-skill", ref: null, path: "" });
  assert.equal(parseGitHubUrl("https://raw.githubusercontent.com/acme/s/main/x/SKILL.md").rawFile, "https://raw.githubusercontent.com/acme/s/main/x/SKILL.md");
  assert.throws(() => parseGitHubUrl("https://gitlab.com/a/b"));
  assert.throws(() => parseGitHubUrl("not a url"));
});

test("importSkill downloads a folder, refuses duplicates, lists choices for collections", async () => {
  const files: Record<string, string> = {
    "skills/pdf/SKILL.md": "---\nname: PDF Tools\ndescription: Use when working with PDFs.\n---\n# PDF\n",
    "skills/pdf/scripts/fill.py": "print(1)\n",
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const send = (s: number, d: unknown) => res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(d));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const m = /^\/repos\/acme\/skills\/contents\/?(.*)$/.exec(url.pathname);
    if (m) {
      const p = decodeURIComponent(m[1]!);
      const kids = new Map<string, { type: string; name: string; path: string; size: number; download_url: string | null }>();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(p ? `${p}/` : "")) continue;
        const rest = f.slice(p ? p.length + 1 : 0).split("/");
        const childPath = p ? `${p}/${rest[0]}` : rest[0]!;
        kids.set(rest[0]!, rest.length === 1 ? { type: "file", name: rest[0]!, path: childPath, size: files[f]!.length, download_url: `${base}/raw/${f}` } : { type: "dir", name: rest[0]!, path: childPath, size: 0, download_url: null });
      }
      return kids.size ? send(200, [...kids.values()]) : send(404, { message: "Not Found" });
    }
    if (url.pathname.startsWith("/raw/")) return res.writeHead(200).end(files[url.pathname.slice(5)]);
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const skillsDir = mkdtempSync(path.join(os.tmpdir(), "cls-skills-"));
  try {
    const r = await importSkill({ url: "https://github.com/acme/skills/tree/main/skills/pdf", skillsDir, apiUrl });
    assert.equal(r.name, "pdf-tools");
    assert.deepEqual(r.files.sort(), ["SKILL.md", "scripts/fill.py"]);
    assert.ok(existsSync(path.join(skillsDir, "pdf-tools/scripts/fill.py")));
    await assert.rejects(importSkill({ url: "https://github.com/acme/skills/tree/main/skills/pdf", skillsDir, apiUrl }), /already exists/);
    assert.equal((await importSkill({ url: "https://github.com/acme/skills/tree/main/skills/pdf", skillsDir, apiUrl, name: "pdf" })).name, "pdf");
    await assert.rejects(importSkill({ url: "https://github.com/acme/skills/tree/main/skills", skillsDir, apiUrl }), (err: Error & { choices?: string[] }) => {
      assert.match(err.message, /several skills/);
      assert.deepEqual(err.choices, ["https://github.com/acme/skills/tree/main/skills/pdf"]);
      return true;
    });
  } finally {
    server.close();
    rmSync(skillsDir, { recursive: true, force: true });
  }
});
