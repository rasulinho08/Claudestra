import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry, parseAgent } from "../src/agents.ts";
import type { Config } from "../src/config.ts";

const agentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../agents");

export function testAgents(): AgentRegistry {
  return new AgentRegistry(
    ["ceo", "researcher", "coder", "reviewer"].map((id) => parseAgent(readFileSync(path.join(agentsDir, `${id}.md`), "utf8"), id)),
  );
}

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    authMode: "claude_cli_login",
    host: "127.0.0.1",
    port: 0,
    models: { cheap: "m-cheap", mid: "m-mid", strong: "m-strong" },
    runBudgetUsd: 2,
    planSizeCap: 6,
    maxConcurrentSteps: 3,
    workspacesDir: path.join(process.env.TMPDIR ?? "/tmp", "claudestra-test-workspaces"),
    agentsDir,
    dbPath: ":memory:",
    ...over,
  };
}
