import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { RunStore } from "./store.ts";
import { AgentRegistry } from "./agents.ts";
import { Orchestrator } from "./orchestrator.ts";
import { createApp } from "./app.ts";
import { resolveSdkAuth } from "./auth.ts";

const config = loadConfig();
const store = new RunStore(config.dbPath);
const agents = AgentRegistry.fromDir(config.agentsDir);
const interrupted = store.failInterrupted();
const app = createApp(config, store, agents, new Orchestrator(config, store, agents));

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const auth = resolveSdkAuth(config.authMode, process.env);
  console.log(`Claudestra server on http://${info.address}:${info.port}  (AUTH_MODE=${config.authMode})`);
  console.log(`  agents: ${agents.infos().map((a) => a.id).join(", ")}`);
  console.log(`  models: cheap=${config.models.cheap} mid=${config.models.mid} strong=${config.models.strong}; run budget $${config.runBudgetUsd}`);
  if (interrupted > 0) console.log(`  closed ${interrupted} run(s) interrupted by the last shutdown`);
  if (!auth.ok) console.warn(`  runs disabled: ${auth.reason}`);
  else if (auth.warning) console.warn(`  note: ${auth.warning}`);
});
