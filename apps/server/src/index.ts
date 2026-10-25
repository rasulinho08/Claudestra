import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, repoRoot } from "./config.ts";
import { RunStore } from "./store.ts";
import { AgentRegistry } from "./agents.ts";
import { Orchestrator } from "./orchestrator.ts";
import { createApp } from "./app.ts";
import { resolveSdkAuth } from "./auth.ts";
import { SkillLibrary } from "./skills.ts";
import { IntegrationRegistry } from "./integrations.ts";
import { WorkflowStore } from "./workflows.ts";

const config = loadConfig();
const store = new RunStore(config.dbPath);
const agents = AgentRegistry.fromDir(config.agentsDir);
const skills = new SkillLibrary(config.skillsDir);
const integrations = new IntegrationRegistry(config.integrationsFile);
const workflows = new WorkflowStore(store);
const interrupted = store.failInterrupted();
const runner = new Orchestrator(config, store, agents, { skills, integrations });
const app = createApp({ config, store, agents, runner, skills, integrations, workflows });

// `npm run build` + `npm start` serves the web app from the same port (no Vite needed).
const webDist = path.join(repoRoot, "apps/web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDist) }));
  app.get("*", serveStatic({ path: path.relative(process.cwd(), path.join(webDist, "index.html")) }));
}

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const auth = resolveSdkAuth(config.authMode, process.env);
  const p = config.profiles[config.defaultProfile];
  console.log(`Claudestra server on http://${info.address}:${info.port}  (AUTH_MODE=${config.authMode})`);
  console.log(`  agents: ${agents.infos().map((a) => a.id).join(", ")}`);
  console.log(`  profile ${config.defaultProfile}: strong=${p.models.strong} mid=${p.models.mid} cheap=${p.models.cheap}; budget $${p.budgetUsd}; approvals ${config.defaultApprovalMode}`);
  console.log(`  skills: ${skills.list().map((s) => s.name).join(", ") || "none"}; integrations: ${integrations.list([]).map((i) => `${i.id}(${i.status})`).join(", ") || "none"}`);
  if (existsSync(webDist)) console.log(`  web app: http://${info.address}:${info.port}/`);
  if (interrupted > 0) console.log(`  closed ${interrupted} run(s) interrupted by the last shutdown`);
  if (!auth.ok) console.warn(`  runs disabled: ${auth.reason}`);
  else if (auth.warning) console.warn(`  note: ${auth.warning}`);
});
