import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { RunStore } from "./store.ts";
import { Runner } from "./runner.ts";
import { createApp } from "./app.ts";
import { resolveSdkAuth } from "./auth.ts";

const config = loadConfig();
const store = new RunStore();
const app = createApp(config, store, new Runner(config, store));

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const auth = resolveSdkAuth(config.authMode, process.env);
  console.log(`Claudestra server on http://${info.address}:${info.port}  (AUTH_MODE=${config.authMode}, model=${config.model})`);
  if (!auth.ok) console.warn(`  runs disabled: ${auth.reason}`);
  else if (auth.warning) console.warn(`  note: ${auth.warning}`);
});
