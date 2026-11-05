// Built-in media and social MCP servers (docs/16): PNG cards, workspace confinement, Postiz publishing.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { IntegrationRegistry } from "../src/integrations.ts";
import { openMcpBridge } from "../src/mcp-bridge.ts";
import { DEFAULT_NEVER_AUTO } from "../src/config.ts";
import { evaluate } from "../src/approvals.ts";

const example = fileURLToPath(new URL("../../../integrations.example.json", import.meta.url));
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#0f172a"/><text x="8" y="38" fill="#fff" font-size="20">Şəkil</text></svg>`;

test("optional ${VAR:-default} values and built-in placeholders resolve", () => {
  const reg = new IntegrationRegistry(example, {});
  const media = reg.config("media");
  assert.ok(media && "config" in media, "media needs no secret");
  const cfg = media.config as { command: string; args: string[]; env: Record<string, string> };
  assert.equal(cfg.command, process.execPath);
  assert.ok(cfg.args[0]!.endsWith(path.join("apps", "server", "mcp", "media.mjs").split(path.sep).join("/")) || cfg.args[0]!.endsWith("media.mjs"));
  assert.equal(cfg.env.MEDIA_MAX_IMAGES, "6");
  assert.equal(cfg.env.GEMINI_API_KEY, "");
  const social = reg.config("social");
  assert.deepEqual(social && "missing" in social ? social.missing : [], ["POSTIZ_API_KEY"]);
  const per = reg.forAgent(["media"], { CLAUDESTRA_WORKSPACE: "/tmp/ws-1" });
  assert.equal((per.servers.media as { env: Record<string, string> }).env.CLAUDESTRA_WORKSPACE, "/tmp/ws-1");
});

test("media server renders SVG cards to PNG and stays inside the workspace", async () => {
  const ws = mkdtempSync(path.join(tmpdir(), "media-"));
  writeFileSync(path.join(ws, "card.svg"), SVG);
  writeFileSync(path.join(ws, "evil.svg"), SVG.replace("<rect", `<image href="/etc/hostname" width="10" height="10"/><rect`));
  const reg = new IntegrationRegistry(example, {});
  const { servers, allows } = reg.forAgent(["media"], { CLAUDESTRA_WORKSPACE: ws });
  const bridge = await openMcpBridge(servers, allows);
  try {
    assert.deepEqual(bridge.errors, []);
    assert.ok(bridge.has("mcp__media__render_png") && bridge.has("mcp__media__generate_image"));
    const signal = new AbortController().signal;
    const ok = await bridge.call("mcp__media__render_png", { svg_file: "card.svg", png_file: "out/card.png", width: 240 }, signal);
    assert.ok(ok.ok, ok.output);
    assert.match(ok.output, /out\/card\.png \(240x120\)/);
    assert.deepEqual([...readFileSync(path.join(ws, "out", "card.png")).subarray(1, 4)], [0x50, 0x4e, 0x47]);
    const escape = await bridge.call("mcp__media__render_png", { svg_file: "card.svg", png_file: "../escape.png" }, signal);
    assert.equal(escape.ok, false);
    assert.ok(!existsSync(path.join(ws, "..", "escape.png")));
    const outsideImage = await bridge.call("mcp__media__render_png", { svg_file: "evil.svg", png_file: "evil.png" }, signal);
    assert.equal(outsideImage.ok, false);
    assert.match(outsideImage.output, /only files in the workspace/);
    const noKey = await bridge.call("mcp__media__generate_image", { prompt: "a blue gradient", image_file: "bg.png" }, signal);
    assert.equal(noKey.ok, false);
    assert.match(noKey.output, /GEMINI_API_KEY/);
  } finally {
    await bridge.close();
  }
});

test("social server checks posts, uploads images and sends them to Postiz", async () => {
  const seen: { method: string; url: string; auth: string; body: string }[] = [];
  const fake = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization), body });
      res.setHeader("content-type", "application/json");
      if (req.url === "/integrations")
        return res.end(JSON.stringify([
          { id: "ig1", name: "Strata", identifier: "instagram", profile: "strata", disabled: false },
          { id: "li1", name: "Strata", identifier: "linkedin-page", disabled: false },
          { id: "x1", name: "Strata", identifier: "x", disabled: false },
        ]));
      if (req.url === "/upload") return res.end(JSON.stringify({ id: "f1", path: "https://cdn.example/f1.png" }));
      if (req.url === "/posts") return res.end(JSON.stringify([{ postId: "p1", integration: "ig1" }]));
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const port = (fake.address() as { port: number }).port;
  const ws = mkdtempSync(path.join(tmpdir(), "social-"));
  writeFileSync(path.join(ws, "card.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const reg = new IntegrationRegistry(example, { POSTIZ_API_KEY: "pk-test", POSTIZ_URL: `http://127.0.0.1:${port}` });
  const { servers, allows } = reg.forAgent(["social"], { CLAUDESTRA_WORKSPACE: ws });
  const bridge = await openMcpBridge(servers, allows);
  const signal = new AbortController().signal;
  try {
    const list = await bridge.call("mcp__social__list_channels", {}, signal);
    assert.ok(list.ok, list.output);
    assert.match(list.output, /ig1 · instagram/);
    const noImage = await bridge.call("mcp__social__create_post", { posts: [{ channel_id: "ig1", text: "Salam" }], when: "now" }, signal);
    assert.equal(noImage.ok, false);
    assert.match(noImage.output, /Instagram needs at least one image/);
    const tooLong = await bridge.call("mcp__social__create_post", { posts: [{ channel_id: "x1", text: "ə".repeat(281) }], when: "now" }, signal);
    assert.match(tooLong.output, /281 characters, limit 280/);
    assert.equal(seen.filter((s) => s.url === "/posts").length, 0, "nothing sent for invalid posts");
    const ok = await bridge.call(
      "mcp__social__create_post",
      { posts: [{ channel_id: "ig1", text: "Yeni məqalə", images: ["card.png"] }, { channel_id: "x1", text: "Yeni məqalə", images: ["card.png"] }], when: "draft" },
      signal,
    );
    assert.ok(ok.ok, ok.output);
    assert.match(ok.output, /Saved as drafts/);
    assert.equal(seen.filter((s) => s.url === "/upload").length, 1, "a shared image is uploaded once");
    const sent = JSON.parse(seen.find((s) => s.url === "/posts")!.body);
    assert.equal(sent.type, "draft");
    assert.deepEqual(sent.posts[0].settings, { __type: "instagram", post_type: "post" });
    assert.deepEqual(sent.posts[1].settings, { __type: "x", who_can_reply_post: "everyone" });
    assert.deepEqual(sent.posts[0].value[0].image, [{ id: "f1", path: "https://cdn.example/f1.png" }]);
    assert.ok(seen.every((s) => s.auth === "pk-test"));
    const outside = await bridge.call("mcp__social__create_post", { posts: [{ channel_id: "li1", text: "x", images: ["../../etc/passwd.png"] }], when: "now" }, signal);
    assert.equal(outside.ok, false);
  } finally {
    await bridge.close();
    fake.close();
  }
});

test("publishing is never auto-approved", () => {
  const gate = evaluate(
    { mode: "auto", workspace: "/tmp", agentName: "content", agentTools: [], mcpAllowed: () => true, requiresApproval: [], neverAuto: DEFAULT_NEVER_AUTO, approvedForRun: new Set(["mcp__social__create_post"]) },
    "mcp__social__create_post",
    { posts: [] },
  );
  assert.equal(gate.kind, "ask");
  const render = evaluate({ mode: "smart", workspace: "/tmp", agentName: "content", agentTools: [], mcpAllowed: () => true, requiresApproval: [], neverAuto: DEFAULT_NEVER_AUTO, approvedForRun: new Set() }, "mcp__media__render_png", {});
  assert.equal(render.kind, "allow");
});
