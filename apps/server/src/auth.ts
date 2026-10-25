// Builds the environment the Agent SDK runs with for each AUTH_MODE (docs/11 §1.1).
import type { AuthMode } from "@claudestra/protocol";

export type SdkAuth =
  | { ok: true; env: Record<string, string | undefined>; warning?: string }
  | { ok: false; reason: string };

export function resolveSdkAuth(mode: AuthMode, env: NodeJS.ProcessEnv): SdkAuth {
  const base: Record<string, string | undefined> = { ...env };
  switch (mode) {
    case "api_key":
      if (!env.ANTHROPIC_API_KEY) {
        return { ok: false, reason: "AUTH_MODE=api_key but ANTHROPIC_API_KEY is not set in .env" };
      }
      return { ok: true, env: base };
    case "claude_cli_login":
      // Force the SDK onto the stored Claude Code login instead of a stray key.
      delete base.ANTHROPIC_API_KEY;
      return {
        ok: true,
        env: base,
        warning:
          "Using your local Claude Code login. Runs count against your subscription limits and this mode is local-only (docs/11).",
      };
    case "bedrock":
      return { ok: true, env: { ...base, CLAUDE_CODE_USE_BEDROCK: "1" } };
    case "vertex":
      return { ok: true, env: { ...base, CLAUDE_CODE_USE_VERTEX: "1" } };
    case "observer":
      return {
        ok: false,
        reason: "AUTH_MODE=observer only visualises Claude Code sessions through hooks; it does not start runs",
      };
  }
}
