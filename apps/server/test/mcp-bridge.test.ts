import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanSchema, functionName, openMcpBridge } from "../src/mcp-bridge.ts";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-mcp.ts");
const tsx = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "tsx", "dist", "cli.mjs");

test("MCP bridge: lists allowed tools as functions, calls them, reports tool errors", async () => {
  const bridge = await openMcpBridge({ fake: { type: "stdio", command: process.execPath, args: [tsx, fixture] } }, (t) => t === "mcp__fake__find_places" || t === "mcp__fake__broken");
  try {
    assert.deepEqual(bridge.errors, []);
    assert.deepEqual(bridge.declarations.map((d) => d.name).sort(), ["mcp__fake__broken", "mcp__fake__find_places"]);
    const decl = bridge.declarations.find((d) => d.name === "mcp__fake__find_places")!;
    assert.equal((decl.parameters as { type: string }).type, "object");
    assert.ok(!("$schema" in decl.parameters) && !("additionalProperties" in decl.parameters));
    assert.equal(bridge.toolName("mcp__fake__find_places"), "mcp__fake__find_places");
    const ok = await bridge.call("mcp__fake__find_places", { city: "Bakı", kind: "restoran" }, new AbortController().signal);
    assert.deepEqual(ok, { ok: true, output: "3 restoran in Bakı: Alpha, Beta, Gamma" });
    const bad = await bridge.call("mcp__fake__broken", {}, new AbortController().signal);
    assert.equal(bad.ok, false);
    assert.equal((await bridge.call("nope", {}, new AbortController().signal)).ok, false);
  } finally {
    await bridge.close();
  }
  const filtered = await openMcpBridge({ fake: { type: "stdio", command: process.execPath, args: [tsx, fixture] } }, (t) => t.endsWith("find_places"));
  assert.deepEqual(filtered.declarations.map((d) => d.name), ["mcp__fake__find_places"]);
  await filtered.close();
  const down = await openMcpBridge({ gone: { type: "http", url: "http://127.0.0.1:9/mcp" } }, () => true);
  assert.equal(down.declarations.length, 0);
  assert.match(down.errors[0]!, /^gone:/);
});

test("function names and schemas are safe for every engine", () => {
  assert.equal(functionName("apify", "apify/rag-web-browser"), "mcp__apify__apify_rag-web-browser");
  const long = functionName("server", "x".repeat(80));
  assert.ok(long.length <= 64 && /^[A-Za-z0-9_-]+$/.test(long));
  assert.deepEqual(cleanSchema({ $schema: "x", type: "object", additionalProperties: false, properties: { a: { type: ["string", "null"], default: 1 } }, required: ["a"] }), {
    type: "object",
    properties: { a: { type: "string" } },
    required: ["a"],
  });
  assert.deepEqual(cleanSchema(undefined), { type: "object", properties: {} });
});
