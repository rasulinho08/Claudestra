// Secrets the server needs but agents must not inherit (a prompt-injected agent could use them with curl or gh).
// Integrations get their own secrets from process.env when Claudestra starts their MCP servers (integrations.ts).
export const SERVER_ONLY_SECRETS = ["GITHUB_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN", "GH_TOKEN", "AUTH_TOKEN", "HOOKS_SECRET", "CLAUDESTRA_HOOKS_SECRET", "DATABASE_URL", "BRAVE_API_KEY"];

// Model keys are needed by the engine process itself, not by the shell commands an agent runs.
export const ENGINE_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "META_API_KEY", "MODEL_API_KEY", "OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"];

export function withoutSecrets<T extends Record<string, string | undefined>>(env: T, names: string[] = SERVER_ONLY_SECRETS): T {
  const out = { ...env };
  for (const n of names) delete out[n];
  return out;
}

// Environment for a shell command run by Claudestra's own Bash tool (Gemini / Meta / OpenAI-compatible engines).
export const shellEnv = () => withoutSecrets(process.env, [...SERVER_ONLY_SECRETS, ...ENGINE_KEYS]);
