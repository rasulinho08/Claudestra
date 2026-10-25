import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthMode } from "@claudestra/protocol";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return n;
}

export type Config = {
  authMode: AuthMode;
  host: string;
  port: number;
  model: string;
  runBudgetUsd: number;
  maxTurns: number;
  workspacesDir: string;
  claudeCodePath?: string;
};

export function loadConfig(): Config {
  const parsed = AuthMode.safeParse(process.env.AUTH_MODE ?? "claude_cli_login");
  if (!parsed.success) {
    throw new Error(`AUTH_MODE must be one of ${AuthMode.options.join(", ")}, got "${process.env.AUTH_MODE}"`);
  }
  return {
    authMode: parsed.data,
    // Local-only until deploy hardening (docs/12): never bind to all interfaces by default.
    host: process.env.HOST ?? "127.0.0.1",
    port: num("PORT", 8787),
    model: process.env.CLAUDESTRA_MODEL ?? "claude-sonnet-5-5",
    runBudgetUsd: num("RUN_BUDGET_USD", 0.5),
    maxTurns: num("MAX_TURNS", 12),
    workspacesDir: path.resolve(repoRoot, process.env.WORKSPACES_DIR ?? "workspaces"),
    claudeCodePath: process.env.CLAUDE_CODE_PATH || undefined,
  };
}
