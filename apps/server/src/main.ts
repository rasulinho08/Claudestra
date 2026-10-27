// Entry point: prints progress immediately, checks the Node version and loads .env before the heavy imports,
// so a failing start always says why (instead of a silent server and "ECONNREFUSED" in the web app).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const log = (msg: string) => console.log(`[claudestra] ${msg}`);
log(`starting server (Node ${process.version}, ${process.platform})…`);

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`[claudestra] Node ${process.version} is too old. Install Node 22.13 or newer (nodejs.org, LTS), then run npm install again.`);
  process.exit(1);
}

// `npm run demo` passes --demo: simulated agents regardless of .env (values already in the environment win over .env).
if (process.argv.includes("--demo")) {
  process.env.AUTH_MODE = "demo";
  log("demo mode (--demo): simulated agents, no AI, $0");
}

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
    log(`loaded ${envFile}`);
  } catch (err) {
    console.error(`[claudestra] could not read .env: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
} else {
  log("no .env file found (copy .env.example to .env); using defaults");
}

const slow = setTimeout(() => log("still starting after 20 s… (antivirus scanning node_modules on first start can be slow; run `npm run doctor` in another window if it stays like this)"), 20_000);
slow.unref();

import("./index.ts")
  .then(() => clearTimeout(slow))
  .catch((err: unknown) => {
    clearTimeout(slow);
    console.error("[claudestra] server failed to start:");
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
