// Shared by the built-in MCP servers: every file they read or write must stay inside the run workspace
// (CLAUDESTRA_WORKSPACE, filled in by Claudestra per step), the same rule the agent tools follow.
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

export function workspaceRoot() {
  const ws = process.env.CLAUDESTRA_WORKSPACE;
  if (!ws || ws === ".") throw new Error("CLAUDESTRA_WORKSPACE is not set: this server runs inside a Claudestra step");
  return realpathSync(ws);
}

const inside = (root, p) => {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// A path relative to the workspace (absolute paths are accepted only when they point inside it).
// Symlinks are resolved so a link cannot lead outside.
export function inWorkspace(p, { create = false } = {}) {
  if (typeof p !== "string" || !p.trim()) throw new Error("a file path is required");
  const root = workspaceRoot();
  const full = path.resolve(root, p);
  if (!inside(root, full)) throw new Error(`${p} is outside the workspace`);
  const dir = path.dirname(full);
  if (create) mkdirSync(dir, { recursive: true });
  if (existsSync(dir) && !inside(root, realpathSync(dir))) throw new Error(`${p} is outside the workspace`);
  if (existsSync(full) && !inside(root, realpathSync(full))) throw new Error(`${p} is outside the workspace`);
  return full;
}

export const rel = (full) => path.relative(workspaceRoot(), full).split(path.sep).join("/");

export const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
