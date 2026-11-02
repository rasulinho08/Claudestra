// Tiny stdio MCP server for tests: one read tool and one tool that fails.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake", version: "1.0.0" });
server.tool("find_places", "Find places in a city", { city: z.string(), kind: z.string().optional() }, async ({ city, kind }) => ({
  content: [{ type: "text", text: `3 ${kind ?? "cafes"} in ${city}: Alpha, Beta, Gamma` }],
}));
server.tool("broken", "Always fails", {}, async () => ({ content: [{ type: "text", text: "quota exceeded" }], isError: true }));
await server.connect(new StdioServerTransport());
