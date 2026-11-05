// MCP integrations registry (docs/05 "Integrations"). Reads integrations.json; "${VAR}" values come from
// the environment so secrets never live in the file. Servers with missing secrets are listed but not attached.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ServerEntry = z.object({
  description: z.string().default(""),
  type: z.enum(["stdio", "http", "sse"]).default("stdio"),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
  // Tool names known to be read-only; shown in the UI and used to suggest allow-lists.
  readTools: z.array(z.string()).default([]),
});
const File = z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), ServerEntry);

export type IntegrationStatus = {
  id: string;
  description: string;
  type: "stdio" | "http" | "sse";
  status: "ready" | "missing_secret" | "invalid";
  missing: string[];
  readTools: string[];
  usedBy: string[];
};

// "${VAR}" is required (the server is not attached without it); "${VAR:-default}" is optional.
const VAR = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

function resolve(value: string, env: NodeJS.ProcessEnv, missing: Set<string>): string {
  return value.replace(VAR, (_, name: string, fallback: string | undefined) => {
    const v = env[name];
    if (v) return v;
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return "";
  });
}

// Values Claudestra fills in itself, so built-in servers (apps/server/mcp/*.mjs) can be started portably:
// CLAUDESTRA_NODE (this Node binary), CLAUDESTRA_ROOT (the repository) and, per step, CLAUDESTRA_WORKSPACE.
export type RuntimeVars = { CLAUDESTRA_WORKSPACE?: string };

export class IntegrationRegistry {
  private entries: Record<string, z.infer<typeof ServerEntry>> = {};
  error?: string;

  private builtins: Record<string, string>;

  constructor(private file: string, private env: NodeJS.ProcessEnv = process.env) {
    this.builtins = { CLAUDESTRA_NODE: process.execPath, CLAUDESTRA_ROOT: path.dirname(path.resolve(file)) };
    this.reload();
  }

  reload() {
    this.entries = {};
    this.error = undefined;
    // Without an integrations.json, the example file shows what can be connected (all missing secrets until set).
    const file = existsSync(this.file) ? this.file : this.file.replace(/\.json$/, ".example.json");
    if (!existsSync(file)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      this.error = `${file}: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    const parsed = File.safeParse(raw);
    if (!parsed.success) {
      this.error = parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ");
      return;
    }
    this.entries = parsed.data;
  }

  // Resolved SDK config for one server, or the env vars it is missing.
  // Without a workspace (status listings) the workspace placeholder counts as present.
  config(id: string, runtime: RuntimeVars = { CLAUDESTRA_WORKSPACE: "." }): { config: McpServerConfig } | { missing: string[] } | undefined {
    const e = this.entries[id];
    if (!e) return undefined;
    const missing = new Set<string>();
    const env = { ...this.env, ...this.builtins, ...runtime };
    let config: McpServerConfig;
    if (e.type === "stdio") {
      if (!e.command) return { missing: ["command"] };
      config = {
        type: "stdio",
        command: resolve(e.command, env, missing),
        args: e.args.map((a) => resolve(a, env, missing)),
        env: Object.fromEntries(Object.entries(e.env).map(([k, v]) => [k, resolve(v, env, missing)])),
      };
    } else {
      if (!e.url) return { missing: ["url"] };
      config = {
        type: e.type,
        url: resolve(e.url, env, missing),
        headers: Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k, resolve(v, env, missing)])),
      };
    }
    return missing.size > 0 ? { missing: [...missing] } : { config };
  }

  // MCP servers for an agent's "server[:toolGlob]" entries, plus a predicate for allowed tool names.
  forAgent(entries: string[], runtime?: RuntimeVars): { servers: Record<string, McpServerConfig>; allows: (tool: string) => boolean; unavailable: string[] } {
    const servers: Record<string, McpServerConfig> = {};
    const unavailable: string[] = [];
    const rules: RegExp[] = [];
    for (const entry of entries) {
      const [server, glob = "*"] = entry.split(":");
      const resolved = this.config(server!, runtime);
      if (!resolved || "missing" in resolved) {
        unavailable.push(server!);
        continue;
      }
      servers[server!] = resolved.config;
      rules.push(new RegExp(`^mcp__${server}__${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
    }
    return { servers, allows: (tool) => rules.some((r) => r.test(tool)), unavailable: [...new Set(unavailable)] };
  }

  list(agents: { id: string; integrations: string[] }[]): IntegrationStatus[] {
    return Object.entries(this.entries).map(([id, e]) => {
      const resolved = this.config(id);
      const missing = resolved && "missing" in resolved ? resolved.missing : [];
      return {
        id,
        description: e.description,
        type: e.type,
        status: missing.length > 0 ? "missing_secret" : "ready",
        missing,
        readTools: e.readTools,
        usedBy: agents.filter((a) => a.integrations.some((i) => i.split(":")[0] === id)).map((a) => a.id),
      };
    });
  }
}
