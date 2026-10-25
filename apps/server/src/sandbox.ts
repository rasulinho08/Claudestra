// Phase 0 permission policy: read-only research tools anywhere inside the run workspace,
// file writes only inside it, everything else denied (docs/09 "Safety").
import path from "node:path";

export const PHASE0_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"];

const PATH_KEYS = ["file_path", "path", "notebook_path"];

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, path.resolve(root, target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function checkToolUse(
  workspace: string,
  tool: string,
  input: Record<string, unknown>,
): { allow: true } | { allow: false; reason: string } {
  if (!PHASE0_TOOLS.includes(tool)) return { allow: false, reason: `${tool} is not enabled in Phase 0` };
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && !isInside(workspace, value)) {
      return { allow: false, reason: `${key} "${value}" is outside the run workspace` };
    }
  }
  return { allow: true };
}
