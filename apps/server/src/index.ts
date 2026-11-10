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
import { Memory } from "./memory.ts";
import { Access } from "./access.ts";
import { RunLauncher } from "./runs.ts";
import { Scheduler, TriggerStore } from "./triggers.ts";
import { MissionRunner, Missions } from "./missions.ts";
import { TelegramBot } from "./telegram.ts";
import { AgentBudgets } from "./budgets.ts";
import { Evals } from "./evals.ts";
import { demoSession } from "./demo.ts";
import { geminiSession } from "./gemini.ts";
import { compatSession } from "./openai-compat.ts";
import { PreviewTokens, startPreviewServer } from "./preview.ts";
import { Projects } from "./projects.ts";
import { Training } from "./training.ts";

const step = (msg: string) => console.log(`[claudestra] ${msg}`);
const config = loadConfig();
step(`opening database ${config.dbPath}`);
const store = new RunStore(config.dbPath);
const agents = AgentRegistry.fromDir(config.agentsDir, [config.teamAgentsDir]);
step(`loaded ${agents.infos().length} agents`);
const skills = new SkillLibrary(config.skillsDir);
const integrations = new IntegrationRegistry(config.integrationsFile);
const workflows = new WorkflowStore(store);
const memory = new Memory(store, config.memoryEnabled);
const access = new Access(store, config.authToken);
const triggers = new TriggerStore(store);
const interrupted = store.failInterrupted();
const training = new Training(store);
const budgets = new AgentBudgets(store);
const runner = new Orchestrator(config, store, agents, { budgets, skills, integrations, memory, training, runSession: config.authMode === "demo" ? demoSession : config.authMode === "gemini" ? geminiSession : config.authMode === "meta" || config.authMode === "openai_compat" ? compatSession : undefined });
const projects = new Projects(store, config.projectsDir, config.snapshotsDir, config.workspacesDir, ["127.0.0.1", "localhost", "::1"].includes(config.host));
const launcher = new RunLauncher(config, store, agents, workflows, runner, projects);
const evals = new Evals(config.evalsDir, store, launcher, config.workspacesDir);
evals.onTimeout = (runId) => runner.cancel(runId);

const loopback = ["127.0.0.1", "localhost", "::1"].includes(config.host);
if (config.publicUrl && !access.enabled) {
  console.error(`PUBLIC_URL is set (${config.publicUrl}) but login is off. Set AUTH_TOKEN in .env (or add a user with \`npm run user -- add NAME owner\`) before opening Claudestra to other people.`);
  process.exit(1);
}
if (!loopback && !access.enabled) {
  console.error(`Refusing to listen on ${config.host} without login. Set AUTH_TOKEN in .env (or add a user with \`npm run user -- add NAME owner\`).`);
  process.exit(1);
}

// "Try it" preview on its own port/origin (docs/07 "Results").
let previewRunning = false;
const previewTokens = new PreviewTokens();
if (config.previewPort) {
  const loopbackHost = ["127.0.0.1", "localhost", "::1"].includes(config.host);
  const opts = { workspacesDir: config.workspacesDir, runExists: (id: string) => store.has(id), tokens: previewTokens, hosts: loopbackHost ? ["localhost", "127.0.0.1", "::1", ...config.allowedHosts] : [] };
  // The browser opens previews as "localhost" when the app is on 127.0.0.1 (and the other way round); localhost may
  // resolve to ::1 first, so listen on both loopback addresses.
  for (const h of loopbackHost ? ["127.0.0.1", "::1"] : [config.host]) {
    const quiet = h === "::1" ? () => {} : step;
    startPreviewServer(h, config.previewPort, opts, quiet).on("listening", () => (previewRunning = true));
  }
}

// Missions (docs/17): the heartbeat that keeps long-running work going in the background.
const missions = new Missions(store);
const missionRunner = new MissionRunner({ missions, store, workspacesDir: config.workspacesDir, start: (req) => launcher.start(req) });
const app = createApp({ budgets, missions, missionRunner, previewRunning: () => previewRunning, previewTokens, projects, training, config, store, agents, runner, skills, integrations, workflows, memory, access, triggers, evals, launcher, templatesDir: config.templatesDir, hooksSecret: config.hooksSecret });
const scheduler = new Scheduler(triggers, (t, params) =>
  launcher.start({ prompt: params.prompt ?? "", workflowId: t.workflowId, params, profile: t.profile, approvalMode: t.approvalMode, origin: `trigger:${t.id}`, createdBy: t.name || "schedule" }).runId,
);
scheduler.start();
missionRunner.start();
// Telegram bot (docs/18): only when a token and at least the bot itself are configured. Without allowed chats it
// answers every message with the chat id to add, and does nothing else.
if (config.telegramToken) {
  new TelegramBot({
    token: config.telegramToken,
    allowedChats: config.telegramChats,
    lang: config.telegramLang,
    store,
    start: (req) => launcher.start(req),
    decide: (runId, approvalId, decision, note) => runner.decide(runId, approvalId, decision, note),
    cancel: (runId) => runner.cancel(runId),
    missions,
    missionRunner,
    appUrl: config.publicUrl ?? `http://${config.host}:${config.port}`,
  }).start();
}

// `npm run build` + `npm start` serves the web app from the same port (no Vite needed).
const webDist = path.join(repoRoot, "apps/web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDist) }));
  app.get("*", serveStatic({ path: path.relative(process.cwd(), path.join(webDist, "index.html")) }));
}

step(`listening on http://${config.host}:${config.port} …`);
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const auth = resolveSdkAuth(config.authMode, process.env);
  const p = config.profiles[config.defaultProfile];
  console.log(`Claudestra server on http://${info.address}:${info.port}  (AUTH_MODE=${config.authMode})`);
  console.log(`  agents: ${agents.infos().map((a) => a.id).join(", ")}`);
  console.log(`  profile ${config.defaultProfile}: strong=${p.models.strong} mid=${p.models.mid} cheap=${p.models.cheap}; budget $${p.budgetUsd}; approvals ${config.defaultApprovalMode}`);
  console.log(`  skills: ${skills.list().map((s) => s.name).join(", ") || "none"}; integrations: ${integrations.list([]).map((i) => `${i.id}(${i.status})`).join(", ") || "none"}`);
  if (existsSync(webDist)) console.log(`  web app: http://${info.address}:${info.port}/`);
  const schedules = triggers.list().filter((t) => t.enabled);
  console.log(`  login: ${access.enabled ? `on (${access.users().length} user(s)${config.authToken ? " + AUTH_TOKEN" : ""})` : "off (local)"}; memory: ${memory.isEnabled ? "on" : "off"}; triggers: ${schedules.length} enabled; telegram: ${config.telegramToken ? (config.telegramChats.length ? `on (${config.telegramChats.length} chat(s))` : "waiting for TELEGRAM_ALLOWED_CHATS") : "off"}`);
  console.log(`  results: preview ${previewRunning ? `http://${config.host}:${config.previewPort}` : "off"}; GitHub export ${config.githubToken ? "on" : "off (set GITHUB_TOKEN)"}`);
  if (interrupted > 0) console.log(`  closed ${interrupted} run(s) interrupted by the last shutdown`);
  if (!auth.ok) console.warn(`  runs disabled: ${auth.reason}`);
  else if (auth.warning) console.warn(`  note: ${auth.warning}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") console.error(`[claudestra] port ${config.port} is already in use: close the other Claudestra window or set PORT in .env.`);
  else console.error(`[claudestra] server error: ${err.message}`);
  process.exit(1);
});
