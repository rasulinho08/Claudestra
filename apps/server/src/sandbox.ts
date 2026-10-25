// Permission policy: read-only research tools anywhere inside the run workspace,
// file writes only inside it, everything else denied (docs/09 "Safety").
import path from "node:path";

// Built-in tools an agent may be granted; MCP tools are governed by integrations (approvals.ts).
export const ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Bash"];

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
  if (!ALLOWED_TOOLS.includes(tool)) return { allow: false, reason: `${tool} is not enabled yet` };
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && !isInside(workspace, value)) {
      return { allow: false, reason: `${key} "${value}" is outside the run workspace` };
    }
  }
  return { allow: true };
}
