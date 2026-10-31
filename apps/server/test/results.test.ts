import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { createApp, hostAllowed, originAllowed, safeRunId, type Services } from "../src/app.ts";
import { RunStore } from "../src/store.ts";
import { SkillLibrary } from "../src/skills.ts";
import { IntegrationRegistry } from "../src/integrations.ts";
import { WorkflowStore } from "../src/workflows.ts";
import { crc32, createZip } from "../src/zip.ts";
import { exportToGitHub, parseRepo, repoSlug } from "../src/github-export.ts";
import { PreviewTokens, previewResponse } from "../src/preview.ts";
import { requiredRole } from "../src/access.ts";
import { testAgents, testConfig } from "./helpers.ts";

// Reads a zip back through its central directory (what unzip tools do).
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : body;
    assert.equal(crc32(data), crc, `crc of ${name}`);
    out.set(name, data.toString("utf8"));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

test("zip: entries round-trip with names, deflate and stored data", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const zip = createZip([
    { path: "index.html", data: Buffer.from("<h1>salam</h1>".repeat(50)) },
    { path: "qovluq/xərc.txt", data: Buffer.from("ə") },
    { path: "empty.txt", data: Buffer.alloc(0) },
  ]);
  const files = unzip(zip);
  assert.equal(files.get("index.html"), "<h1>salam</h1>".repeat(50));
  assert.equal(files.get("qovluq/xərc.txt"), "ə");
  assert.equal(files.get("empty.txt"), "");
});

test("originAllowed: same host and dev origins pass, other sites and opaque origins fail", () => {
  const dev = ["http://127.0.0.1:5173"];
  assert.equal(originAllowed(undefined, "127.0.0.1:8787", dev), true);
  assert.equal(originAllowed("http://127.0.0.1:8787", "127.0.0.1:8787", dev), true);
  assert.equal(originAllowed("http://127.0.0.1:5173", "127.0.0.1:8787", dev), true);
  assert.equal(originAllowed("http://127.0.0.1:8788", "127.0.0.1:8787", dev), false); // the preview origin
  assert.equal(originAllowed("https://evil.example", "127.0.0.1:8787", dev), false);
  assert.equal(originAllowed("null", "127.0.0.1:8787", dev), false);
});

test("hostAllowed and safeRunId: DNS rebinding and path-like run ids are refused", () => {
  assert.equal(hostAllowed("127.0.0.1:8787", "127.0.0.1"), true);
  assert.equal(hostAllowed("localhost:5173", "127.0.0.1"), true);
  assert.equal(hostAllowed("[::1]:8787", "127.0.0.1"), true);
  assert.equal(hostAllowed("evil.example:8787", "127.0.0.1"), false);
  assert.equal(hostAllowed("my-pc.lan", "127.0.0.1", ["my-pc.lan"]), true);
  assert.equal(hostAllowed("anything", "0.0.0.0"), true); // deployed: login protects it
  assert.equal(safeRunId("0123abcd-0000-4000-8000-000000000000"), true);
  assert.equal(safeRunId("obs-abc_123"), true);
  for (const bad of ["obs-/../x", "..", "a/b", "a\\b", "C:x", ""]) assert.equal(safeRunId(bad), false, bad);
});

test("repo names: slugs from Azerbaijani prompts, NAME or OWNER/NAME", () => {
  assert.equal(repoSlug('Kiçik bir "Xərc izləyici" veb tətbiqi'), "kicik-bir-xerc-izleyici-veb-tetbiqi");
  assert.equal(repoSlug("!!!"), "claudestra-project");
  assert.deepEqual(parseRepo("demo"), { owner: null, name: "demo" });
  assert.deepEqual(parseRepo("https://github.com/acme/demo.git"), { owner: "acme", name: "demo" });
  assert.throws(() => parseRepo("a/b/c"));
  assert.throws(() => parseRepo("../x"));
  assert.throws(() => parseRepo("bad name"));
});

test("preview: per-run token, types, no traversal, no symlink escape, folder redirect, Host check", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cls-preview-"));
  const id = "0123abcd-0000-4000-8000-000000000000";
  mkdirSync(path.join(root, id, "sub"), { recursive: true });
  writeFileSync(path.join(root, id, "index.html"), "<p>hi</p>");
  writeFileSync(path.join(root, id, "sub", "app.js"), "1");
  writeFileSync(path.join(root, id, "sub", "index.html"), "<p>sub</p>");
  mkdirSync(path.join(root, "outside"));
  writeFileSync(path.join(root, "outside", "secret.txt"), "no");
  writeFileSync(path.join(root, "secret.txt"), "no");
  symlinkSync(path.join(root, "outside"), path.join(root, id, "up"), process.platform === "win32" ? "junction" : "dir");
  const tokens = new PreviewTokens();
  const o = { workspacesDir: root, runExists: (r: string) => r === id, tokens, hosts: ["localhost", "127.0.0.1"] };
  const base = `/${id}/${tokens.tokenFor(id)}`;
  try {
    const page = previewResponse(`${base}/`, o, "localhost:8788");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"]!, /text\/html/);
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    assert.equal(previewResponse(`${base}/sub/app.js`, o).headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal(previewResponse(base, o).status, 302);
    const folder = previewResponse(`${base}/sub`, o);
    assert.equal(folder.status, 302);
    assert.equal(folder.headers.location, `${base}/sub/`);
    assert.equal(previewResponse(`${base}/sub/`, o).body.toString(), "<p>sub</p>");
    assert.equal(previewResponse(`${base}/..%2Fsecret.txt`, o).status, 403);
    assert.notEqual(previewResponse(`${base}/%2e%2e/%2e%2e/secret.txt`, o).status, 200);
    assert.equal(previewResponse(`${base}/up/secret.txt`, o).status, 403, "symlink out of the workspace");
    assert.equal(previewResponse(`${base}/missing.html`, o).status, 404);
    assert.equal(previewResponse(`/${id}/${"0".repeat(32)}/`, o).status, 404, "wrong token");
    assert.equal(previewResponse(`/${id}/`, o).status, 404, "no token");
    assert.equal(previewResponse(`${base}/`, o, "evil.example:8788").status, 403, "DNS rebinding");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("roles: GitHub push and open-folder need the owner", () => {
  assert.equal(requiredRole("POST", "/api/runs/abc/github"), "owner");
  assert.equal(requiredRole("POST", "/api/runs/abc/open-folder"), "owner");
  assert.equal(requiredRole("GET", "/api/runs/abc/zip"), "viewer");
  assert.equal(requiredRole("POST", "/api/runs/abc/cancel"), "operator");
});

// A fake GitHub that keeps repos, blobs, trees and refs in memory.
function fakeGitHub() {
  const calls: string[] = [];
  const repos = new Map<string, { branch: string; head: string | null }>();
  const objects = new Map<string, unknown>();
  let n = 0;
  let limitedOnce = false;
  const id = () => `sha${++n}`;
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = req.url!;
    calls.push(`${req.method} ${url}`);
    const send = (status: number, data: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
    if (req.headers.authorization !== "Bearer good") return send(401, { message: "Bad credentials" });
    let m: RegExpExecArray | null;
    if (url === "/user") return send(200, { login: "rasul" });
    if (req.method === "POST" && url === "/user/repos") {
      const init = id();
      objects.set(init, { tree: { sha: "inittree" } });
      repos.set(`rasul/${body.name}`, { branch: "main", head: init });
      return send(201, { html_url: `https://github.com/rasul/${body.name}`, default_branch: "main", full_name: `rasul/${body.name}`, private: body.private });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)$/.exec(url))) {
      const r = repos.get(m[1]!);
      return r ? send(200, { html_url: `https://github.com/${m[1]}`, default_branch: r.branch, full_name: m[1] }) : send(404, { message: "Not Found" });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/ref\/heads\/(.+)$/.exec(url))) {
      const r = repos.get(m[1]!);
      return r?.head ? send(200, { object: { sha: r.head } }) : send(404, { message: "Not Found" });
    }
    if ((m = /^\/repos\/[^/]+\/[^/]+\/git\/commits\/(.+)$/.exec(url))) return send(200, objects.get(m[1]!));
    if (/\/git\/blobs$/.test(url)) {
      if (!limitedOnce) {
        limitedOnce = true;
        return res.writeHead(403, { "content-type": "application/json", "retry-after": "1" }).end(JSON.stringify({ message: "You have exceeded a secondary rate limit" }));
      }
      const sha = id();
      objects.set(sha, Buffer.from(body.content, "base64").toString("utf8"));
      return send(201, { sha });
    }
    if (/\/git\/trees$/.test(url)) {
      const sha = id();
      objects.set(sha, body);
      return send(201, { sha });
    }
    if (/\/git\/commits$/.test(url)) {
      const sha = id();
      objects.set(sha, { tree: { sha: body.tree }, parents: body.parents, message: body.message });
      return send(201, { sha });
    }
    if (req.method === "PATCH" && (m = /^\/repos\/([^/]+\/[^/]+)\/git\/refs\/heads\/(.+)$/.exec(url))) {
      repos.get(m[1]!)!.head = body.sha;
      return send(200, { object: { sha: body.sha } });
    }
    send(404, { message: `no route ${req.method} ${url}` });
  });
  return { server, calls, repos, objects };
}

test("GitHub export: creates a private repo, then adds a commit on top for the next push", async () => {
  const gh = fakeGitHub();
  await new Promise<void>((r) => gh.server.listen(0, "127.0.0.1", r));
  const apiUrl = `http://127.0.0.1:${(gh.server.address() as AddressInfo).port}`;
  try {
    const files = [
      { path: "index.html", data: Buffer.from("<h1>x</h1>") },
      { path: "src/app.js", data: Buffer.from("console.log(1)") },
      { path: "logo.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]) },
    ];
    const first = await exportToGitHub({ token: "good", repo: "xerc", files, message: "first", apiUrl, retryDelayMs: 1 });
    assert.equal(first.created, true);
    assert.equal(first.repo, "rasul/xerc");
    assert.equal(first.files, 3);
    assert.ok(gh.calls.includes("POST /user/repos"));
    const firstTree = gh.objects.get((gh.objects.get(first.commit) as { tree: { sha: string } }).tree.sha) as { base_tree?: string; tree: { path: string; content?: string; sha?: string }[] };
    assert.equal(firstTree.base_tree, undefined); // replaces the generated README
    assert.deepEqual(firstTree.tree.map((t) => t.path), ["index.html", "logo.png", "src/app.js"]);
    assert.equal(firstTree.tree[0]!.content, "<h1>x</h1>", "text goes inline");
    assert.ok(firstTree.tree[1]!.sha && !firstTree.tree[1]!.content, "binary goes as a blob");
    assert.equal(gh.calls.filter((c) => c.endsWith("/git/blobs")).length, 2, "one rate-limited blob call retried");
    assert.equal(gh.repos.get("rasul/xerc")!.head, first.commit);

    const second = await exportToGitHub({ token: "good", repo: "rasul/xerc", files: files.slice(0, 1), message: "second", apiUrl, retryDelayMs: 1 });
    assert.equal(second.created, false);
    const commit = gh.objects.get(second.commit) as { parents: string[]; tree: { sha: string } };
    assert.deepEqual(commit.parents, [first.commit]);
    assert.ok((gh.objects.get(commit.tree.sha) as { base_tree?: string }).base_tree, "existing repo keeps its files");

    await assert.rejects(exportToGitHub({ token: "bad", repo: "x", files, message: "m", apiUrl }), /rejected GITHUB_TOKEN/);
    await assert.rejects(exportToGitHub({ token: "good", repo: "x", files: [], message: "m", apiUrl }), /no files/);
  } finally {
    gh.server.close();
  }
});

test("routes: ZIP download, open folder, GitHub without a token, cross-origin writes refused", async () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cls-ws-"));
  const config = testConfig({ workspacesDir: ws });
  const store = new RunStore();
  const opened: string[] = [];
  const services: Services = {
    config,
    store,
    agents: testAgents(),
    runner: { start: async () => {}, cancel: () => false, pause: () => false, resume: () => false, decide: () => false },
    skills: new SkillLibrary(config.skillsDir),
    integrations: new IntegrationRegistry(config.integrationsFile, {}),
    workflows: new WorkflowStore(store),
    openFolder: (d) => opened.push(d),
  };
  const app = createApp(services);
  try {
    const id = "11111111-2222-4333-8444-555555555555";
    store.create({ id, prompt: "Xərc izləyici", source: "claudestra" });
    assert.equal((await app.request(`/api/runs/${id}/zip`)).status, 404); // no files yet
    mkdirSync(path.join(ws, id, ".claudestra"), { recursive: true });
    writeFileSync(path.join(ws, id, "index.html"), "<b>ok</b>");
    writeFileSync(path.join(ws, id, ".claudestra", "notes.md"), "internal");

    const zipRes = await app.request(`/api/runs/${id}/zip`);
    assert.equal(zipRes.status, 200);
    assert.match(zipRes.headers.get("content-disposition")!, /xerc-izleyici-11111111\.zip/);
    const files = unzip(Buffer.from(await zipRes.arrayBuffer()));
    assert.deepEqual([...files.keys()], ["index.html"]);

    const open = await app.request(`/api/runs/${id}/open-folder`, { method: "POST", body: "{}" });
    assert.equal(open.status, 200);
    assert.deepEqual(opened, [path.join(ws, id)]);

    const gh = await app.request(`/api/runs/${id}/github`, { method: "POST", body: JSON.stringify({ repo: "x" }), headers: { "content-type": "application/json" } });
    assert.equal(gh.status, 400);
    assert.match(((await gh.json()) as { error: string }).error, /GITHUB_TOKEN/);

    const evil = await app.request("/api/runs", { method: "POST", body: JSON.stringify({ prompt: "rm -rf" }), headers: { origin: "https://evil.example", host: "127.0.0.1:8787" } });
    assert.equal(evil.status, 403);
    const fromPreview = await app.request(`/api/runs/${id}/cancel`, { method: "POST", body: "{}", headers: { origin: "http://127.0.0.1:8788", host: "127.0.0.1:8787" } });
    assert.equal(fromPreview.status, 403);
    const previewHost = await app.request(`/api/runs/${id}/cancel`, { method: "POST", body: "{}", headers: { origin: "http://localhost:8788", host: "127.0.0.1:8787" } });
    assert.equal(previewHost.status, 403);
    const rebound = await app.request("/api/runs", { headers: { host: "evil.example:8787" } });
    assert.equal(rebound.status, 403);
    const badHook = await app.request("/hooks/SessionStart", { method: "POST", body: JSON.stringify({ session_id: "/../../../etc" }), headers: { "content-type": "text/plain" } });
    assert.equal(badHook.status, 400);
    const crossHook = await app.request("/hooks/SessionStart", { method: "POST", body: JSON.stringify({ session_id: "abc" }), headers: { origin: "https://evil.example", host: "127.0.0.1:8787" } });
    assert.equal(crossHook.status, 403);
    assert.equal((await app.request(`/api/runs/${encodeURIComponent("obs-/../x")}/zip`)).status, 404);

    const health = (await (await app.request("/api/health")).json()) as { results: { github: boolean; previewPort: number | null } };
    assert.deepEqual([health.results.github, health.results.previewPort], [false, null]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
