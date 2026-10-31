// Import a skill from GitHub (upgrade A2): a folder with SKILL.md, e.g.
//   https://github.com/OWNER/REPO/tree/main/skills/pdf      (folder)
//   https://github.com/OWNER/REPO/blob/main/skills/pdf/SKILL.md
//   https://github.com/OWNER/REPO                             (repo whose root is a skill)
//   https://raw.githubusercontent.com/OWNER/REPO/main/path/SKILL.md (single file)
// Files are fetched with the GitHub contents API (GITHUB_TOKEN optional, raises the rate limit) and written to
// skills/<name>/. A skill's scripts are only text until an agent runs them; Bash still goes through approvals.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isInside } from "./sandbox.ts";

const MAX_FILES = 40;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 3;

export type GitHubLocation = { owner: string; repo: string; ref: string | null; path: string; rawFile?: string };

export class SkillImportError extends Error {
  constructor(message: string, readonly choices: string[] = []) {
    super(message);
  }
}

export function parseGitHubUrl(url: string): GitHubLocation {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new SkillImportError("paste a github.com link to a folder that contains SKILL.md");
  }
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const ok = (s: string | undefined) => Boolean(s && /^[\w.-]+$/.test(s) && s !== "." && s !== "..");
  if (u.hostname === "raw.githubusercontent.com") {
    const [owner, repo, ref, ...rest] = parts;
    if (!ok(owner) || !ok(repo) || !ref || rest.length === 0) throw new SkillImportError("unrecognised raw.githubusercontent.com link");
    return { owner: owner!, repo: repo!, ref, path: rest.slice(0, -1).join("/"), rawFile: url.trim() };
  }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") throw new SkillImportError("only github.com links are supported");
  const [owner, repoRaw, kind, ref, ...rest] = parts;
  const repo = repoRaw?.replace(/\.git$/, "");
  if (!ok(owner) || !ok(repo)) throw new SkillImportError("the link must look like https://github.com/OWNER/REPO/tree/BRANCH/path/to/skill");
  if (!kind) return { owner: owner!, repo: repo!, ref: null, path: "" };
  if ((kind !== "tree" && kind !== "blob") || !ref) throw new SkillImportError("the link must point to a folder (…/tree/…) or a SKILL.md file (…/blob/…)");
  let p = rest.join("/");
  if (kind === "blob") p = rest.slice(0, -1).join("/"); // the file's folder
  if (p.split("/").some((s) => s === ".." || s === ".")) throw new SkillImportError("bad path");
  return { owner: owner!, repo: repo!, ref, path: p };
}

type Entry = { type: "file" | "dir" | string; name: string; path: string; size: number; download_url: string | null };

export async function importSkill(opts: {
  url: string;
  skillsDir: string;
  name?: string;
  overwrite?: boolean;
  token?: string | null;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; files: string[] }> {
  const f = opts.fetchImpl ?? fetch;
  const api = (opts.apiUrl || "https://api.github.com").replace(/\/+$/, "");
  const loc = parseGitHubUrl(opts.url);
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "Claudestra", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) };
  const getJson = async (p: string): Promise<unknown> => {
    const q = loc.ref ? `?ref=${encodeURIComponent(loc.ref)}` : "";
    const res = await f(`${api}/repos/${loc.owner}/${loc.repo}/contents/${p.split("/").filter(Boolean).map(encodeURIComponent).join("/")}${q}`, { headers });
    if (res.status === 404) throw new SkillImportError(`not found on GitHub: ${loc.owner}/${loc.repo}/${p} (private repos need GITHUB_TOKEN)`);
    if (res.status === 403 || res.status === 429) throw new SkillImportError("GitHub rate limit reached; set GITHUB_TOKEN in .env or try again later");
    if (!res.ok) throw new SkillImportError(`GitHub returned HTTP ${res.status}`);
    return res.json();
  };
  const getBytes = async (url: string): Promise<Buffer> => {
    const res = await f(url, { headers: { "user-agent": "Claudestra", ...(opts.token && /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(url) ? { authorization: `Bearer ${opts.token}` } : {}) } });
    if (!res.ok) throw new SkillImportError(`could not download ${url} (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) throw new SkillImportError(`${url} is larger than ${MAX_FILE_BYTES / 1024} KB`);
    return buf;
  };

  const files: { rel: string; data: Buffer }[] = [];
  if (loc.rawFile) {
    files.push({ rel: "SKILL.md", data: await getBytes(loc.rawFile) });
  } else {
    const top = (await getJson(loc.path)) as Entry[] | Entry;
    if (!Array.isArray(top)) throw new SkillImportError("the link points to a file; link the folder that contains SKILL.md");
    if (!top.some((e) => e.type === "file" && e.name === "SKILL.md")) {
      // A collection (e.g. a repo's skills/ folder): tell the caller which sub-folders are skills.
      const dirs = top.filter((e) => e.type === "dir");
      const choices: string[] = [];
      for (const d of dirs.slice(0, 60)) {
        const inner = (await getJson(d.path).catch(() => [])) as Entry[];
        if (Array.isArray(inner) && inner.some((e) => e.name === "SKILL.md")) choices.push(`https://github.com/${loc.owner}/${loc.repo}/tree/${loc.ref ?? "HEAD"}/${d.path}`);
      }
      throw new SkillImportError(choices.length ? "this folder holds several skills; pick one" : "no SKILL.md in this folder", choices);
    }
    let total = 0;
    const walk = async (entries: Entry[], prefix: string, depth: number) => {
      for (const e of entries) {
        if (files.length >= MAX_FILES) throw new SkillImportError(`a skill may have at most ${MAX_FILES} files`);
        if (e.type === "dir") {
          if (depth >= MAX_DEPTH) continue;
          await walk((await getJson(e.path)) as Entry[], `${prefix}${e.name}/`, depth + 1);
        } else if (e.type === "file" && e.download_url) {
          if (e.size > MAX_FILE_BYTES) throw new SkillImportError(`${e.path} is larger than ${MAX_FILE_BYTES / 1024} KB`);
          total += e.size;
          if (total > MAX_TOTAL_BYTES) throw new SkillImportError(`the skill is larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB`);
          files.push({ rel: `${prefix}${e.name}`, data: await getBytes(e.download_url) });
        }
      }
    };
    await walk(top, "", 0);
  }

  const skillMd = files.find((x) => x.rel === "SKILL.md")!.data.toString("utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  if (!fm || !/^description:/m.test(fm[1]!)) throw new SkillImportError("SKILL.md has no frontmatter with a description");
  const declared = /^name:\s*["']?([^"'\r\n]+)/m.exec(fm[1]!)?.[1]?.trim();
  const name = slug(opts.name || declared || loc.path.split("/").pop() || loc.repo);
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new SkillImportError("could not derive a valid skill name; give one");
  const dir = path.join(opts.skillsDir, name);
  if (existsSync(dir) && !opts.overwrite) throw new SkillImportError(`a skill named ${name} already exists; choose another name or overwrite`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  for (const file of files) {
    const target = path.resolve(dir, file.rel);
    if (!isInside(dir, target)) throw new SkillImportError(`refusing ${file.rel}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.data);
  }
  return { name, files: files.map((x) => x.rel) };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
