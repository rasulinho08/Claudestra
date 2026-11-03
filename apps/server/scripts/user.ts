// Manage login users:  npm run user -- add NAME [owner|operator|viewer] [AGENT_ID]  |  link NAME AGENT_ID  |  list  |  remove NAME
import { existsSync } from "node:fs";
import { loadConfig, repoRoot } from "../src/config.ts";
import { RunStore } from "../src/store.ts";
import { Access } from "../src/access.ts";
import { Role } from "@claudestra/protocol";

const envFile = `${repoRoot}/.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);
const [cmd, name, roleArg = "owner", agentArg] = process.argv.slice(2);
const config = loadConfig();
const access = new Access(new RunStore(config.dbPath), config.authToken);

if (cmd === "add" && name) {
  const role = Role.parse(roleArg);
  const { user, token } = access.addUser(name, role, agentArg ?? null);
  console.log(`Added ${user.name} (${user.role}${user.agentId ? `, agent ${user.agentId}` : ""}). Token (shown once, keep it safe):\n\n  ${token}\n\nLog in at the web app with this token. Login is now required for everyone.`);
} else if (cmd === "link" && name && roleArg) {
  // Second argument is the agent id here: npm run user -- link nihad project-manager
  console.log(access.setAgent(name, roleArg === "none" ? null : roleArg) ? `Linked ${name} to ${roleArg}.` : `No user named ${name}.`);
} else if (cmd === "list") {
  const users = access.users();
  if (users.length === 0) console.log("No users. Login is off unless AUTH_TOKEN is set.");
  for (const u of users) console.log(`${u.name.padEnd(20)} ${u.role.padEnd(9)} ${(u.agentId ?? "-").padEnd(18)} last seen ${u.lastSeen ?? "never"}`);
} else if (cmd === "remove" && name) {
  console.log(access.removeUser(name) ? `Removed ${name}.` : `No user named ${name}.`);
} else {
  console.log("Usage: npm run user -- add NAME [owner|operator|viewer] [AGENT_ID] | link NAME AGENT_ID | list | remove NAME");
  process.exit(1);
}
