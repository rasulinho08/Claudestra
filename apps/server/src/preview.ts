// "Try it" preview (docs/07 "Results"): serves run workspaces read-only on a separate port (PREVIEW_PORT, default
// PORT+1). The web app opens it under the *other* loopback name (127.0.0.1 <-> localhost), so the previewed page is a
// different origin and a different site: it gets its own localStorage and cookies, cannot read the API, cannot set
// the API's cookies, and the API refuses its writes (originAllowed in app.ts). Every URL carries a per-run token
// (/<runId>/<token>/...) so other local pages cannot browse workspaces, and files are resolved with realpath so a
// symlink or Windows junction inside a workspace cannot reach files outside it.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isInside } from "./sandbox.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

// Per-process secret; tokens are HMAC(runId), handed out by GET /api/runs/:id/preview to users who may read the run.
export class PreviewTokens {
  private secret = randomBytes(32);
  tokenFor(runId: string): string {
    return createHmac("sha256", this.secret).update(runId).digest("hex").slice(0, 32);
  }
  valid(runId: string, token: string): boolean {
    const want = Buffer.from(this.tokenFor(runId));
    const got = Buffer.from(token);
    return want.length === got.length && timingSafeEqual(want, got);
  }
}

export type PreviewOptions = {
  workspacesDir: string;
  runExists: (runId: string) => boolean;
  tokens: PreviewTokens;
  // Host names the browser may use (DNS-rebinding guard); empty = any.
  hosts?: string[];
};

export type PreviewResponse = { status: number; headers: Record<string, string>; body: Buffer | string };

const text = (status: number, body: string): PreviewResponse => ({ status, headers: { "content-type": "text/plain; charset=utf-8" }, body });

export function previewResponse(url: string, o: PreviewOptions, host?: string): PreviewResponse {
  if (o.hosts?.length && host) {
    const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
    if (!o.hosts.includes(name)) return text(403, "unexpected Host header");
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://x").pathname);
  } catch {
    return text(400, "bad path");
  }
  const m = /^\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/([0-9a-f]{32})(\/.*)?$/.exec(pathname);
  if (!m || m[1]!.includes("..")) return text(404, "Not found. Open previews from Claudestra (▶ Try it).");
  const [, runId, token, restPath] = m as unknown as [string, string, string, string | undefined];
  if (!o.tokens.valid(runId, token) || !o.runExists(runId)) return text(404, "Unknown run or expired link (links change when Claudestra restarts).");
  const base = `/${runId}/${token}/`;
  if (!restPath) return { status: 302, headers: { location: base }, body: "" };
  const root = path.join(o.workspacesDir, runId);
  let rel = restPath.slice(1);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel.includes("\0") || !isInside(root, path.resolve(root, rel))) return text(403, "outside the workspace");
  let file = path.resolve(root, rel);
  try {
    // Follow links, then check the real location is still inside the real workspace.
    const realRoot = realpathSync.native(root);
    let real = realpathSync.native(file);
    if (!isInside(realRoot, real) || real === realRoot) return text(403, "outside the workspace");
    if (statSync(real).isDirectory()) {
      // Relative links in a folder's index.html need the trailing slash.
      if (!restPath.endsWith("/")) return { status: 302, headers: { location: `${base}${rel.split("/").map(encodeURIComponent).join("/")}/` }, body: "" };
      file = path.join(real, "index.html");
      real = realpathSync.native(file);
      if (!isInside(realRoot, real)) return text(403, "outside the workspace");
    }
    const body = readFileSync(real);
    return {
      status: 200,
      headers: {
        "content-type": TYPES[path.extname(real).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
      body,
    };
  } catch {
    return text(404, `${rel} does not exist in this run's workspace`);
  }
}

export function startPreviewServer(host: string, port: number, o: PreviewOptions, log: (m: string) => void): Server {
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const r = previewResponse(req.url ?? "/", o, req.headers.host);
    res.writeHead(r.status, r.headers);
    res.end(req.method === "HEAD" ? undefined : r.body);
  });
  server.on("error", (err: NodeJS.ErrnoException) => log(`preview server not started (${err.code === "EADDRINUSE" ? `port ${port} is in use; set PREVIEW_PORT` : err.message}); "Try it" is off`));
  server.listen(port, host);
  return server;
}
