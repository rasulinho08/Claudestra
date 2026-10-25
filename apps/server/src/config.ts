import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthMode, type ModelClass } from "@claudestra/protocol";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
  // Concrete model ids per class (docs/11 §2.2); agents pick a class, not an id.
  models: Record<ModelClass, string>;
  runBudgetUsd: number;
  planSizeCap: number;
  maxConcurrentSteps: number;
  workspacesDir: string;
  agentsDir: string;
  dbPath: string;
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
    models: {
      cheap: process.env.MODEL_CHEAP || "claude-haiku-5-5",
      mid: process.env.MODEL_MID || "claude-haiku-5-5",
      strong: process.env.MODEL_STRONG || "claude-sonnet-5-5",
    },
    runBudgetUsd: num("RUN_BUDGET_USD", 2),
    planSizeCap: num("PLAN_SIZE_CAP", 6),
    maxConcurrentSteps: num("MAX_CONCURRENT_STEPS", 3),
    workspacesDir: path.resolve(repoRoot, process.env.WORKSPACES_DIR ?? "workspaces"),
    agentsDir: path.resolve(repoRoot, process.env.AGENTS_DIR ?? "agents"),
    dbPath: process.env.DB_PATH === ":memory:" ? ":memory:" : path.resolve(repoRoot, process.env.DB_PATH ?? "data/claudestra.db"),
    claudeCodePath: process.env.CLAUDE_CODE_PATH || undefined,
  };
}
