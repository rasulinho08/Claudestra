import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApprovalMode, AuthMode, Profile, type ModelClass, type ProfileInfo } from "@claudestra/protocol";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return n;
}

function optionalNum(name: string): number | null {
  return process.env[name] ? num(name, 0) : null;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function choice<T extends string>(name: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } ; options: readonly T[] }, fallback: T): T {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`${name} must be one of ${schema.options.join(", ")}, got "${raw}"`);
  return parsed.data;
}

export type Config = {
  authMode: AuthMode;
  host: string;
  port: number;
  // Concrete model ids per class for each profile (docs/11 §2.2); agents pick a class, not an id.
  profiles: Record<Profile, ProfileInfo>;
  defaultProfile: Profile;
  defaultApprovalMode: ApprovalMode;
  // Patterns that still ask in auto mode (docs/04 "Approval modes").
  neverAuto: string[];
  maxConcurrentSteps: number;
  maxLoopIterations: number;
  maxRetriesPerStep: number;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  // OS-level sandbox for Bash where Claude Code supports it (Linux/macOS).
  osSandbox: boolean;
  workspacesDir: string;
  agentsDir: string;
  skillsDir: string;
  integrationsFile: string;
  evalsDir: string;
  templatesDir: string;
  dbPath: string;
  memoryEnabled: boolean;
  // Login (docs/12): a single owner token; more users can be added with `npm run user`.
  authToken: string | null;
  hooksSecret: string | null;
  claudeCodePath?: string;
  // Results (docs/07): "Try it" preview port (0 = off), its public URL when deployed, GitHub export token.
  previewPort: number;
  previewUrl: string | null;
  githubToken: string | null;
  githubApiUrl: string;
  // Browser origins allowed to call the API besides the server's own (the Vite dev server).
  webOrigins: string[];
  // Extra host names the browser may use for a server bound to this computer (DNS-rebinding guard).
  allowedHosts: string[];
  // Projects (upgrade A3): Claudestra-managed project folders and the undo snapshots of applied changes.
  projectsDir: string;
  snapshotsDir: string;
};

const localEngine = (e: NodeJS.ProcessEnv) =>
  ["ollama", "lmstudio", "lm-studio", "lm_studio"].includes((e.OPENAI_PROVIDER ?? "").toLowerCase()) || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(e.OPENAI_BASE_URL ?? "");

export const DEFAULT_NEVER_AUTO = ["Bash:*git push*", "Bash:*rm -rf*", "Bash:*sudo *", "mcp__*__create_*", "mcp__*__delete_*", "mcp__*__update_*", "mcp__*__push_*", "mcp__*__merge_*"];

export function loadConfig(): Config {
  // Non-Claude engines have their own model ids (docs/11 §1.1); everything else uses Claude models.
  const mode = process.env.AUTH_MODE;
  const gemini = mode === "gemini";
  const e = process.env;
  const pick = (cls: "STRONG" | "MID" | "CHEAP", claude: string, geminiDefault: string) => {
    if (mode === "meta") return e[`META_MODEL_${cls}`] || e.META_MODEL || "muse-spark-1.3";
    if (mode === "openai_compat") return e[`OPENAI_MODEL_${cls}`] || e.OPENAI_MODEL || "";
    if (gemini) return e[`GEMINI_MODEL_${cls}`] || geminiDefault;
    return e[`MODEL_${cls}`] || claude;
  };
  const strong = pick("STRONG", "claude-sonnet-5-5", "gemini-3.8-flash");
  const mid = pick("MID", "claude-haiku-5-5", "gemini-3.8-flash");
  const cheap = pick("CHEAP", "claude-haiku-5-5", "gemini-3.5-flash-lite");
  const compat = mode === "meta" || mode === "openai_compat";
  const models = (m: Record<ModelClass, string>) => m;
  return {
    authMode: choice("AUTH_MODE", AuthMode, "claude_cli_login"),
    // Local-only until deploy hardening (docs/12): never bind to all interfaces by default.
    host: process.env.HOST ?? "127.0.0.1",
    port: num("PORT", 8787),
    profiles: {
      eco: {
        models: models({ cheap, mid: cheap, strong: process.env.MODEL_ECO_STRONG || strong }),
        planSizeCap: num("ECO_PLAN_SIZE_CAP", 3),
        budgetUsd: num("ECO_BUDGET_USD", 0.5),
      },
      balanced: {
        models: models({ cheap, mid, strong }),
        planSizeCap: num("PLAN_SIZE_CAP", 6),
        budgetUsd: num("RUN_BUDGET_USD", 2),
      },
      max: {
        models: models({ cheap, mid: (gemini || compat ? undefined : process.env.MODEL_MAX_MID) || strong, strong: (gemini ? process.env.GEMINI_MODEL_MAX : compat ? undefined : process.env.MODEL_MAX_STRONG) || (gemini || compat ? strong : "claude-opus-5-5") }),
        planSizeCap: num("MAX_PLAN_SIZE_CAP", 10),
        budgetUsd: num("MAX_BUDGET_USD", 8),
      },
    },
    defaultProfile: choice("DEFAULT_PROFILE", Profile, "balanced"),
    defaultApprovalMode: choice("DEFAULT_APPROVAL_MODE", ApprovalMode, "smart"),
    neverAuto: list("NEVER_AUTO", DEFAULT_NEVER_AUTO),
    // A local model (Ollama / LM Studio) runs on this PC: one step at a time unless set explicitly (upgrade E3).
    maxConcurrentSteps: num("MAX_CONCURRENT_STEPS", mode === "openai_compat" && localEngine(e) ? 1 : 3),
    maxLoopIterations: num("MAX_LOOP_ITERATIONS", 2),
    maxRetriesPerStep: num("MAX_RETRIES_PER_STEP", 1),
    dailyBudgetUsd: optionalNum("DAILY_BUDGET_USD"),
    monthlyBudgetUsd: optionalNum("MONTHLY_BUDGET_USD"),
    osSandbox: (process.env.OS_SANDBOX ?? "auto") === "auto" ? process.platform !== "win32" : process.env.OS_SANDBOX === "on",
    workspacesDir: path.resolve(repoRoot, process.env.WORKSPACES_DIR ?? "workspaces"),
    agentsDir: path.resolve(repoRoot, process.env.AGENTS_DIR ?? "agents"),
    skillsDir: path.resolve(repoRoot, process.env.SKILLS_DIR ?? "skills"),
    integrationsFile: path.resolve(repoRoot, process.env.INTEGRATIONS_FILE ?? "integrations.json"),
    evalsDir: path.resolve(repoRoot, process.env.EVALS_DIR ?? "evals"),
    templatesDir: path.resolve(repoRoot, process.env.TEMPLATES_DIR ?? "templates"),
    memoryEnabled: (process.env.MEMORY ?? "on") !== "off",
    authToken: process.env.AUTH_TOKEN || null,
    hooksSecret: process.env.HOOKS_SECRET || null,
    dbPath: process.env.DB_PATH === ":memory:" ? ":memory:" : path.resolve(repoRoot, process.env.DB_PATH ?? "data/claudestra.db"),
    claudeCodePath: process.env.CLAUDE_CODE_PATH || undefined,
    previewPort: process.env.PREVIEW_PORT === "0" ? 0 : num("PREVIEW_PORT", num("PORT", 8787) + 1),
    previewUrl: process.env.PREVIEW_URL?.replace(/\/+$/, "") || null,
    githubToken: process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || null,
    githubApiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
    webOrigins: list("WEB_ORIGINS", ["http://127.0.0.1:5173", "http://localhost:5173"]),
    allowedHosts: list("ALLOWED_HOSTS", []),
    projectsDir: path.resolve(repoRoot, process.env.PROJECTS_DIR ?? "projects"),
    snapshotsDir: path.resolve(repoRoot, process.env.SNAPSHOTS_DIR ?? "data/snapshots"),
  };
}
