// Projects (upgrade A3, docs/04 "Projects"): keep working on the same files across runs.
//   - A project is a folder: managed by Claudestra (projects/<id>/) or a real folder on this PC ("bring it in").
//   - A run in a project starts from a copy of the project's files (its workspace) plus a baseline of hashes, so the
//     agents never touch the real folder while they work.
//   - After the run, its changes (added / modified / deleted) are listed against that baseline and applied back on
//     request. Every apply takes a snapshot of what it overwrites, so it can be undone.
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunStore } from "./store.ts";
import { listFiles } from "./files.ts";
import { isInside } from "./sandbox.ts";

export type Project = { id: string; name: string; folder: string | null; path: string; createdAt: string; updatedAt: string };
export type ProjectRun = { runId: string; prompt: string; status: string; startedAt: string; appliedAt: string | null; undoneAt: string | null };
export type Change = { path: string; kind: "added" | "modified" | "deleted"; conflict: boolean; binary: boolean; before?: string; after?: string; bytes: number };

const BASELINE = ".claudestra/baseline.json";
const MAX_FILES = 5000;
const MAX_BYTES = 200 * 1024 * 1024;
const DIFF_TEXT_LIMIT = 200 * 1024;

// Files that belong to Claudestra or tools, never copied back into a project.
const internal = (rel: string) => rel.startsWith(".claudestra/") || rel.startsWith(".claude/");

const hashFile = (file: string) => createHash("sha1").update(readFileSync(file)).digest("hex");

// The path an apply/undo may write: inside the project folder after following links, and not itself a link.
// A symlink or junction inside a real project folder must not let a run write elsewhere on the PC.
export function safeTarget(root: string, rel: string): string | null {
  const target = path.resolve(root, rel);
  if (!isInside(root, target) || target === path.resolve(root)) return null;
  let realRoot: string;
  try {
    realRoot = realpathSync.native(root);
  } catch {
    return null;
  }
  // Deepest folder on the way that already exists, resolved through links.
  let dir = path.dirname(target);
  while (!existsSync(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir);
  try {
    if (!isInside(realRoot, realpathSync.native(dir))) return null;
    if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
      const st = lstatSync(target);
      if (st.isSymbolicLink() || st.isDirectory()) return null;
    }
  } catch {
    return null;
  }
  return target;
}

export class ProjectError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

export class Projects {
  constructor(
    private store: RunStore,
    private projectsDir: string,
    private snapshotsDir: string,
    private workspacesDir: string,
    private allowExternal: boolean,
  ) {
    store.database.exec(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_runs (
      run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, applied_at TEXT, undone_at TEXT, applied TEXT);`);
  }

  private row = (r: { id: string; name: string; folder: string | null; created_at: string; updated_at: string }): Project => ({
    id: r.id,
    name: r.name,
    folder: r.folder,
    path: r.folder ?? path.join(this.projectsDir, r.id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  list(): (Project & { runs: number; lastRunAt: string | null })[] {
    const rows = this.store.database.prepare("SELECT id, name, folder, created_at, updated_at FROM projects ORDER BY updated_at DESC").all() as Parameters<typeof this.row>[0][];
    return rows.map((r) => {
      const stats = this.store.database.prepare("SELECT COUNT(*) AS n, MAX(r.started_at) AS last FROM project_runs p JOIN runs r ON r.id = p.run_id WHERE p.project_id = ?").get(r.id) as { n: number; last: string | null };
      return { ...this.row(r), runs: stats.n, lastRunAt: stats.last };
    });
  }

  get(id: string): Project | undefined {
    const r = this.store.database.prepare("SELECT id, name, folder, created_at, updated_at FROM projects WHERE id = ?").get(id) as Parameters<typeof this.row>[0] | undefined;
    return r && this.row(r);
  }

  create(name: string, folder?: string | null): Project {
    const clean = name.trim();
    if (!clean || clean.length > 80) throw new ProjectError("a project needs a name (up to 80 characters)");
    let external: string | null = null;
    if (folder && folder.trim()) {
      if (!this.allowExternal) throw new ProjectError("linking a folder on this PC is only possible when Claudestra runs locally");
      external = path.resolve(folder.trim());
      checkExternalFolder(external, [this.workspacesDir, this.projectsDir, this.snapshotsDir]);
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    if (!external) mkdirSync(path.join(this.projectsDir, id), { recursive: true });
    this.store.database.prepare("INSERT INTO projects (id, name, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, clean, external, now, now);
    return this.get(id)!;
  }

  remove(id: string, deleteFiles: boolean) {
    const p = this.get(id);
    if (!p) throw new ProjectError("project not found", 404);
    this.store.database.prepare("DELETE FROM projects WHERE id = ?").run(id);
    this.store.database.prepare("DELETE FROM project_runs WHERE project_id = ?").run(id);
    // Only Claudestra's own folder is ever deleted; a linked real folder stays untouched.
    if (deleteFiles && !p.folder) rmSync(p.path, { recursive: true, force: true });
    rmSync(path.join(this.snapshotsDir, id), { recursive: true, force: true });
  }

  runs(projectId: string): ProjectRun[] {
    return (
      this.store.database
        .prepare("SELECT p.run_id, r.prompt, r.status, r.started_at, p.applied_at, p.undone_at FROM project_runs p JOIN runs r ON r.id = p.run_id WHERE p.project_id = ? ORDER BY r.started_at DESC LIMIT 100")
        .all(projectId) as { run_id: string; prompt: string; status: string; started_at: string; applied_at: string | null; undone_at: string | null }[]
    ).map((r) => ({ runId: r.run_id, prompt: r.prompt, status: r.status, startedAt: r.started_at, appliedAt: r.applied_at, undoneAt: r.undone_at }));
  }

  projectOf(runId: string): Project | undefined {
    const r = this.store.database.prepare("SELECT project_id FROM project_runs WHERE run_id = ?").get(runId) as { project_id: string } | undefined;
    return r ? this.get(r.project_id) : undefined;
  }

  // Copies the project's files into a fresh run workspace and records the baseline. Returns a context note for agents.
  prepareRun(projectId: string, runId: string, workspace: string): string {
    const p = this.get(projectId);
    if (!p) throw new ProjectError("project not found", 404);
    if (!existsSync(p.path)) throw new ProjectError(`the project folder ${p.path} does not exist any more`, 409);
    const files = listFiles(p.path, MAX_FILES + 1).filter((f) => !internal(f.path));
    if (files.length > MAX_FILES) throw new ProjectError(`the project has more than ${MAX_FILES} files (node_modules and .git are skipped); use a smaller folder`, 409);
    const total = files.reduce((n, f) => n + f.bytes, 0);
    if (total > MAX_BYTES) throw new ProjectError(`the project is larger than ${MAX_BYTES / 1024 / 1024} MB`, 409);
    const baseline: Record<string, string> = {};
    for (const f of files) {
      const src = path.join(p.path, f.path);
      const dst = path.join(workspace, f.path);
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      baseline[f.path] = hashFile(src);
    }
    mkdirSync(path.join(workspace, ".claudestra"), { recursive: true });
    writeFileSync(path.join(workspace, BASELINE), JSON.stringify({ projectId, files: baseline }), "utf8");
    this.store.database.prepare("INSERT OR REPLACE INTO project_runs (run_id, project_id) VALUES (?, ?)").run(runId, projectId);
    this.touch(projectId);

    const previous = this.runs(projectId).filter((r) => r.runId !== runId).slice(0, 5);
    const shown = files.slice(0, 40).map((f) => `- ${f.path}`).join("\n");
    return [
      `This run continues the project "${p.name}". The workspace already contains the project's current files (${files.length} file(s)); change them in place and keep what works, do not start over.`,
      files.length ? `Project files:\n${shown}${files.length > 40 ? `\n- … and ${files.length - 40} more` : ""}` : "The project is still empty.",
      previous.length ? `Earlier tasks in this project (newest first):\n${previous.map((r) => `- ${r.prompt.replace(/\s+/g, " ").slice(0, 160)}${r.appliedAt && !r.undoneAt ? " (applied)" : ""}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private touch(projectId: string) {
    this.store.database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), projectId);
  }

  private baselineOf(workspace: string): { projectId: string; files: Record<string, string> } {
    try {
      return JSON.parse(readFileSync(path.join(workspace, BASELINE), "utf8"));
    } catch {
      throw new ProjectError("this run was not started in a project", 404);
    }
  }

  // What the run changed compared with the files it started from; conflict = the project changed meanwhile.
  changes(runId: string, withText = true): Change[] {
    const workspace = path.join(this.workspacesDir, runId);
    const base = this.baselineOf(workspace);
    const p = this.get(base.projectId);
    if (!p) throw new ProjectError("the project was deleted", 404);
    const now = new Map(listFiles(workspace, MAX_FILES + 1).filter((f) => !internal(f.path)).map((f) => [f.path, f]));
    const out: Change[] = [];
    const currentHash = (rel: string) => {
      const file = path.join(p.path, rel);
      return existsSync(file) && statSync(file).isFile() ? hashFile(file) : null;
    };
    const text = (file: string) => {
      if (!withText || !existsSync(file)) return { binary: false, value: undefined as string | undefined };
      const buf = readFileSync(file);
      const binary = buf.subarray(0, 8000).includes(0);
      return { binary, value: binary ? undefined : buf.subarray(0, DIFF_TEXT_LIMIT).toString("utf8") };
    };
    for (const [rel, f] of now) {
      const before = base.files[rel];
      const hash = hashFile(path.join(workspace, rel));
      if (before === hash) continue;
      const kind = before ? "modified" : "added";
      const after = text(path.join(workspace, rel));
      const old = kind === "modified" ? text(path.join(p.path, rel)) : { binary: false, value: undefined };
      out.push({ path: rel, kind, conflict: currentHash(rel) !== (before ?? null), binary: after.binary || old.binary, before: old.value, after: after.value, bytes: f.bytes });
    }
    for (const rel of Object.keys(base.files)) {
      if (now.has(rel)) continue;
      out.push({ path: rel, kind: "deleted", conflict: currentHash(rel) !== base.files[rel], binary: false, bytes: 0 });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // Applies the chosen changes (all by default) to the project folder; conflicts need force. Snapshot first.
  apply(runId: string, opts: { paths?: string[]; force?: boolean } = {}): { applied: string[]; skipped: { path: string; reason: string }[] } {
    const workspace = path.join(this.workspacesDir, runId);
    const base = this.baselineOf(workspace);
    const p = this.get(base.projectId);
    if (!p) throw new ProjectError("the project was deleted", 404);
    const pr = this.store.database.prepare("SELECT applied_at, undone_at FROM project_runs WHERE run_id = ?").get(runId) as { applied_at: string | null; undone_at: string | null } | undefined;
    if (pr?.applied_at && !pr.undone_at) throw new ProjectError("this run's changes were already applied; undo first to apply again", 409);
    const wanted = opts.paths ? new Set(opts.paths) : null;
    const changes = this.changes(runId, false).filter((c) => !wanted || wanted.has(c.path));
    const snapDir = path.join(this.snapshotsDir, p.id, runId);
    rmSync(snapDir, { recursive: true, force: true });
    mkdirSync(snapDir, { recursive: true });
    const record: { path: string; existed: boolean }[] = [];
    const applied: string[] = [];
    const skipped: { path: string; reason: string }[] = [];
    for (const c of changes) {
      if (c.conflict && !opts.force) {
        skipped.push({ path: c.path, reason: "changed in the project since this run started" });
        continue;
      }
      const target = safeTarget(p.path, c.path);
      if (!target) {
        skipped.push({ path: c.path, reason: "outside the project folder (or a link / folder there)" });
        continue;
      }
      const existed = existsSync(target);
      if (existed) {
        const backup = path.join(snapDir, "files", c.path);
        mkdirSync(path.dirname(backup), { recursive: true });
        copyFileSync(target, backup);
      }
      record.push({ path: c.path, existed });
      if (c.kind === "deleted") {
        if (existed) rmSync(target, { force: true });
      } else {
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(path.join(workspace, c.path), target);
      }
      applied.push(c.path);
    }
    writeFileSync(path.join(snapDir, "manifest.json"), JSON.stringify({ runId, at: new Date().toISOString(), files: record }), "utf8");
    this.store.database
      .prepare("UPDATE project_runs SET applied_at = ?, undone_at = NULL, applied = ? WHERE run_id = ?")
      .run(new Date().toISOString(), JSON.stringify(applied), runId);
    this.touch(p.id);
    return { applied, skipped };
  }

  // Puts back what an apply overwrote and removes the files it created.
  undo(runId: string): { restored: number } {
    const projectId = (this.store.database.prepare("SELECT project_id FROM project_runs WHERE run_id = ?").get(runId) as { project_id: string } | undefined)?.project_id;
    const p = projectId ? this.get(projectId) : undefined;
    if (!p) throw new ProjectError("project not found", 404);
    const snapDir = path.join(this.snapshotsDir, p.id, runId);
    let manifest: { files: { path: string; existed: boolean }[] };
    try {
      manifest = JSON.parse(readFileSync(path.join(snapDir, "manifest.json"), "utf8"));
    } catch {
      throw new ProjectError("nothing to undo for this run", 404);
    }
    let restored = 0;
    for (const f of manifest.files) {
      const target = safeTarget(p.path, f.path);
      if (!target) continue;
      if (f.existed) {
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(path.join(snapDir, "files", f.path), target);
      } else rmSync(target, { force: true });
      restored++;
    }
    rmSync(snapDir, { recursive: true, force: true });
    this.store.database.prepare("UPDATE project_runs SET undone_at = ? WHERE run_id = ?").run(new Date().toISOString(), runId);
    this.touch(p.id);
    return { restored };
  }

  files(projectId: string) {
    const p = this.get(projectId);
    if (!p) throw new ProjectError("project not found", 404);
    return existsSync(p.path) ? listFiles(p.path).filter((f) => !internal(f.path)) : [];
  }
}

// A linked folder must be a real project folder, not a drive root, the home folder, a system folder or Claudestra's own data.
export function checkExternalFolder(dir: string, own: string[]) {
  if (!path.isAbsolute(dir)) throw new ProjectError("give the full path of the folder (for example C:\\Users\\me\\Documents\\my-site)");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new ProjectError(`${dir} is not an existing folder`);
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  const d = norm(dir);
  if (path.parse(dir).root.replace(/[\\/]+$/, "").toLowerCase() === d) throw new ProjectError("a whole drive cannot be a project; pick a folder");
  if (d === norm(os.homedir())) throw new ProjectError("your whole home folder cannot be a project; pick a folder inside it");
  const system = process.platform === "win32" ? [process.env.SystemRoot ?? "C:\\Windows", process.env.ProgramFiles ?? "C:\\Program Files", process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", process.env.ProgramData ?? "C:\\ProgramData"] : ["/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/sbin", "/sys", "/usr", "/var", "/System", "/Library"];
  for (const s of system) if (d === norm(s) || d.startsWith(`${norm(s)}${path.sep}`)) throw new ProjectError("system folders cannot be projects");
  for (const o of own) if (d === norm(o) || d.startsWith(`${norm(o)}${path.sep}`) || norm(o).startsWith(`${d}${path.sep}`)) throw new ProjectError("this folder belongs to Claudestra itself (or contains its data); pick another folder");
}
