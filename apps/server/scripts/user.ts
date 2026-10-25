// Manage login users:  npm run user -- add NAME [owner|operator|viewer]  |  list  |  remove NAME
import { loadConfig } from "../src/config.ts";
import { RunStore } from "../src/store.ts";
import { Access } from "../src/access.ts";
import { Role } from "@claudestra/protocol";

const [cmd, name, roleArg = "owner"] = process.argv.slice(2);
const config = loadConfig();
const access = new Access(new RunStore(config.dbPath), config.authToken);

if (cmd === "add" && name) {
  const role = Role.parse(roleArg);
  const { user, token } = access.addUser(name, role);
  console.log(`Added ${user.name} (${user.role}). Token (shown once, keep it safe):\n\n  ${token}\n\nLog in at the web app with this token. Login is now required for everyone.`);
} else if (cmd === "list") {
  const users = access.users();
  if (users.length === 0) console.log("No users. Login is off unless AUTH_TOKEN is set.");
  for (const u of users) console.log(`${u.name.padEnd(20)} ${u.role.padEnd(9)} last seen ${u.lastSeen ?? "never"}`);
} else if (cmd === "remove" && name) {
  console.log(access.removeUser(name) ? `Removed ${name}.` : `No user named ${name}.`);
} else {
  console.log("Usage: npm run user -- add NAME [owner|operator|viewer] | list | remove NAME");
  process.exit(1);
}
