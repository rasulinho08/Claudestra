// Builds the environment the Agent SDK runs with for each AUTH_MODE (docs/11 §1.1).
import type { AuthMode } from "@claudestra/protocol";
import { compatEndpoint } from "./openai-compat.ts";

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
    case "gemini":
      if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
        return { ok: false, reason: "AUTH_MODE=gemini but GEMINI_API_KEY is not set in .env (get a free key at aistudio.google.com)" };
      }
      return {
        ok: true,
        env: base,
        warning: "Using Google Gemini. Agents use Claudestra's own tools (files, Bash, web); skills and MCP apps are not available in this mode.",
      };
    case "meta":
    case "openai_compat": {
      const ep = compatEndpoint({ ...env, AUTH_MODE: mode });
      if ("error" in ep) return { ok: false, reason: ep.error };
      return {
        ok: true,
        env: { ...base, AUTH_MODE: mode },
        warning: `Using ${ep.name} (${ep.baseUrl}). Agents use Claudestra's own tools (files, Bash, web); skills and MCP apps are not available in this mode.`,
      };
    }
    case "demo":
      return { ok: true, env: base, warning: "Demo mode: agents are simulated, no AI is called and nothing is charged. Set AUTH_MODE in .env to use Claude." };
    case "observer":
      return {
        ok: false,
        reason: "AUTH_MODE=observer only visualises Claude Code sessions through hooks; it does not start runs",
      };
  }
}
