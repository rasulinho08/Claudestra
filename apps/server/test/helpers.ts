import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry, parseAgent } from "../src/agents.ts";
import { DEFAULT_NEVER_AUTO, type Config } from "../src/config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const agentsDir = path.join(root, "agents");

export const ALL_AGENTS = ["ceo", "researcher", "business-analyst", "architect", "coder", "reviewer", "tester", "security", "doc-writer", "data-analyst", "project-manager"];

export function testAgents(): AgentRegistry {
  return new AgentRegistry(ALL_AGENTS.map((id) => parseAgent(readFileSync(path.join(agentsDir, `${id}.md`), "utf8"), id)));
}

const models = { cheap: "m-cheap", mid: "m-mid", strong: "m-strong" };

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    authMode: "claude_cli_login",
    host: "127.0.0.1",
    port: 0,
    profiles: {
      eco: { models, planSizeCap: 3, budgetUsd: 0.5 },
      balanced: { models, planSizeCap: 6, budgetUsd: 2 },
      max: { models: { ...models, strong: "m-max" }, planSizeCap: 10, budgetUsd: 8 },
    },
    defaultProfile: "balanced",
    defaultApprovalMode: "smart",
    neverAuto: DEFAULT_NEVER_AUTO,
    maxConcurrentSteps: 3,
    maxLoopIterations: 2,
    maxRetriesPerStep: 1,
    dailyBudgetUsd: null,
    monthlyBudgetUsd: null,
    osSandbox: false,
    workspacesDir: path.join(process.env.TMPDIR ?? "/tmp", "claudestra-test-workspaces"),
    agentsDir,
    skillsDir: path.join(root, "skills"),
    integrationsFile: path.join(root, "integrations.example.json"),
    evalsDir: path.join(root, "evals"),
    templatesDir: path.join(root, "templates"),
    memoryEnabled: true,
    authToken: null,
    hooksSecret: null,
    dbPath: ":memory:",
    ...over,
  };
}
