// MCP bridge for the Gemini / Meta / OpenAI-compatible engines (upgrade I3): Claudestra itself connects to the agent's
// MCP servers (integrations.json, e.g. Apify), lists their tools as function declarations named
// mcp__<server>__<tool>, and calls them when the model asks. Every call still goes through authorize() (approvals).
// Claude sessions keep using the SDK's own MCP support.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ToolDeclaration } from "./local-tools.ts";
import { shellEnv } from "./secret-env.ts";

const MAX_OUTPUT = 20_000;
const CONNECT_TIMEOUT_MS = 30_000;

export type McpBridge = {
  declarations: ToolDeclaration[];
  // Function name -> server and tool.
  has(name: string): boolean;
  // The SDK-style name (mcp__server__tool) used by approvals and integration allow-lists.
  toolName(name: string): string;
  call(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; output: string }>;
  errors: string[];
  close(): Promise<void>;
};

// Function names must be ≤64 chars of [A-Za-z0-9_-] for OpenAI-style APIs (Gemini allows the same set).
export function functionName(server: string, tool: string): string {
  const raw = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (raw.length <= 64) return raw;
  let h = 0;
  for (const c of raw) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${raw.slice(0, 55)}_${h.toString(36).slice(0, 8)}`;
}

// JSON Schema keys every engine accepts; Gemini rejects $schema, additionalProperties, $ref and friends.
const KEEP = new Set(["type", "description", "properties", "required", "items", "enum", "format", "nullable", "minimum", "maximum", "minItems", "maxItems"]);
export function cleanSchema(schema: unknown, depth = 0): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || depth > 8) return { type: "object", properties: {} };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, cleanSchema(pv, depth + 1)]));
    else if (k === "items") out.items = cleanSchema(v, depth + 1);
    else if (k === "type" && Array.isArray(v)) out.type = v.find((x) => x !== "null") ?? "string";
    else out[k] = v;
  }
  if (!out.type) out.type = out.properties ? "object" : "string";
  if (out.type === "object" && !out.properties) out.properties = {};
  return out;
}

function transportFor(config: McpServerConfig, http: "streamable" | "sse") {
  if (config.type === "http" || config.type === "sse") {
    const url = new URL(config.url);
    const headers = config.headers ?? {};
    return config.type === "sse" || http === "sse" ? new SSEClientTransport(url, { requestInit: { headers } }) : new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  }
  if (!("command" in config) || !config.command) throw new Error("stdio server without a command");
  // Local MCP servers get a clean environment plus their own declared variables (secrets resolved by integrations.ts).
  const env = { ...(shellEnv() as Record<string, string>), ...(config.env ?? {}) };
  return new StdioClientTransport({ command: config.command, args: config.args ?? [], env, stderr: "ignore" });
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms).unref?.())]);

export async function openMcpBridge(servers: Record<string, McpServerConfig>, allows: (tool: string) => boolean): Promise<McpBridge> {
  const clients: Client[] = [];
  const routes = new Map<string, { client: Client; tool: string; sdkName: string }>();
  const declarations: ToolDeclaration[] = [];
  const errors: string[] = [];
  for (const [server, config] of Object.entries(servers)) {
    let client: Client | null = null;
    for (const mode of ["streamable", "sse"] as const) {
      const c = new Client({ name: "claudestra", version: "1.0.0" });
      try {
        await withTimeout(c.connect(transportFor(config, mode)), CONNECT_TIMEOUT_MS, `connecting to ${server}`);
        client = c;
        break;
      } catch (err) {
        await c.close().catch(() => {});
        if (mode === "sse" || config.type === "stdio" || config.type === "sse") errors.push(`${server}: ${err instanceof Error ? err.message : String(err)}`);
        if (config.type !== "http") break;
      }
    }
    if (!client) continue;
    clients.push(client);
    try {
      let cursor: string | undefined;
      do {
        const page = await withTimeout(client.listTools(cursor ? { cursor } : {}), CONNECT_TIMEOUT_MS, `listing ${server} tools`);
        for (const tool of page.tools) {
          const sdkName = `mcp__${server}__${tool.name}`;
          if (!allows(sdkName)) continue;
          const name = functionName(server, tool.name);
          routes.set(name, { client, tool: tool.name, sdkName });
          declarations.push({ name, description: (tool.description ?? `${server} ${tool.name}`).slice(0, 1000), parameters: cleanSchema(tool.inputSchema) });
        }
        cursor = page.nextCursor;
      } while (cursor);
    } catch (err) {
      errors.push(`${server}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    declarations,
    errors,
    has: (name) => routes.has(name),
    toolName: (name) => routes.get(name)?.sdkName ?? name,
    async call(name, input, signal) {
      const route = routes.get(name);
      if (!route) return { ok: false, output: `Unknown tool ${name}` };
      const result = (await route.client.callTool({ name: route.tool, arguments: input }, undefined, { signal, timeout: 300_000 })) as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
      const text =
        (result.content ?? [])
          .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
          .join("\n")
          .trim() || (result.structuredContent ? JSON.stringify(result.structuredContent) : "(no output)");
      return { ok: !result.isError, output: text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… [${text.length - MAX_OUTPUT} more characters]` : text };
    },
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
}
