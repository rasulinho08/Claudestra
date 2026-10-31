// Read-only view of a run's workspace for the artifacts browser (docs/07 "Files").
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isInside } from "./sandbox.ts";

export type FileEntry = { path: string; bytes: number; modified: string };

const SKIP = new Set([".git", "node_modules", ".claude", "__pycache__", ".venv"]);
const MAX_FILES = 500;
export const MAX_FILE_BYTES = 512 * 1024;

export function listFiles(root: string, maxFiles = MAX_FILES): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (dir: string) => {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const st = statSync(full);
        out.push({ path: path.relative(root, full).split(path.sep).join("/"), bytes: st.size, modified: st.mtime.toISOString() });
      }
      if (out.length >= maxFiles) return;
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function readWorkspaceFile(root: string, rel: string): { content: string; truncated: boolean; binary: boolean } {
  if (!rel || path.isAbsolute(rel) || !isInside(root, rel)) throw new Error("path must be inside the run workspace");
  const buf = readFileSync(path.join(root, rel));
  const slice = buf.subarray(0, MAX_FILE_BYTES);
  const binary = slice.includes(0);
  return { content: binary ? "" : slice.toString("utf8"), truncated: buf.length > MAX_FILE_BYTES, binary };
}

// Files to export (ZIP, GitHub): everything except Claudestra's own notes, up to a total size.
export const EXPORT_MAX_BYTES = 100 * 1024 * 1024;
export const EXPORT_MAX_FILES = 5000;

export function exportFiles(root: string, includeInternal = false): { path: string; data: Buffer; modified: Date }[] {
  const out: { path: string; data: Buffer; modified: Date }[] = [];
  let total = 0;
  const all = listFiles(root, EXPORT_MAX_FILES + 1);
  // Never export a silently truncated folder.
  if (all.length > EXPORT_MAX_FILES) throw new Error(`the workspace has more than ${EXPORT_MAX_FILES} files; export it from the folder instead`);
  for (const f of all) {
    if (!includeInternal && f.path.startsWith(".claudestra/")) continue;
    if (total + f.bytes > EXPORT_MAX_BYTES) throw new Error(`the workspace is larger than ${EXPORT_MAX_BYTES / 1024 / 1024} MB; export it from the folder instead`);
    total += f.bytes;
    out.push({ path: f.path, data: readFileSync(path.join(root, f.path)), modified: new Date(f.modified) });
  }
  return out;
}
