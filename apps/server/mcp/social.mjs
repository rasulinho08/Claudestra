// Built-in "social" MCP server (docs/16): publishes to Instagram, LinkedIn, X and other networks through Postiz
// (postiz.com cloud, or self-hosted for free). Claudestra never holds the social network passwords: you connect the
// accounts in Postiz once, and the agent only gets a Postiz API key (POSTIZ_API_KEY, server-side).
// create_post always needs a person's approval (DEFAULT_NEVER_AUTO "mcp__*__create_*"), even in auto mode.
import { readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { inWorkspace, text } from "./workspace-path.mjs";

const BASE = (process.env.POSTIZ_URL || "https://api.postiz.com/public/v1").replace(/\/$/, "");
const KEY = process.env.POSTIZ_API_KEY ?? "";
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4" };
// Platform limits checked before anything is sent (the platform would reject the post anyway).
const LIMITS = { x: 280, linkedin: 3000, "linkedin-page": 3000, instagram: 2200, "instagram-standalone": 2200 };

async function postiz(pathname, init = {}) {
  if (!KEY) throw new Error("POSTIZ_API_KEY is not set in .env (Postiz → Settings → Public API)");
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers: { Authorization: KEY, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  const raw = await res.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  if (!res.ok) throw new Error(`Postiz ${res.status}: ${typeof body === "string" ? body.slice(0, 300) : (body?.message ?? JSON.stringify(body).slice(0, 300))}`);
  return body;
}

async function channels() {
  const list = await postiz("/integrations");
  return (Array.isArray(list) ? list : []).map((c) => ({ id: c.id, name: c.name, platform: c.identifier, profile: c.profile, disabled: !!c.disabled }));
}

// Settings each provider requires (Postiz public API "settings.__type").
function settingsFor(platform) {
  if (platform === "x") return { __type: "x", who_can_reply_post: "everyone" };
  if (platform === "instagram" || platform === "instagram-standalone") return { __type: platform, post_type: "post" };
  return { __type: platform };
}

async function upload(file) {
  const full = inWorkspace(file);
  const type = IMAGE_TYPES[path.extname(full).toLowerCase()];
  if (!type) throw new Error(`${file}: only PNG, JPG, WebP, GIF or MP4 can be posted (render SVG cards to PNG first)`);
  const form = new FormData();
  form.append("file", new Blob([readFileSync(full)], { type }), path.basename(full));
  const r = await postiz("/upload", { method: "POST", body: form });
  return { id: r.id, path: r.path };
}

const server = new McpServer({ name: "claudestra-social", version: "1.0.0" });

server.tool("list_channels", "List the social accounts connected in Postiz (id, name, platform: instagram, linkedin, linkedin-page, x, …). Read-only.", {}, async () => {
  try {
    const list = await channels();
    if (list.length === 0) return text("No accounts connected yet. Connect Instagram, LinkedIn and X in Postiz first.");
    return text(list.map((c) => `- ${c.id} · ${c.platform} · ${c.name}${c.profile ? ` (@${c.profile})` : ""}${c.disabled ? " · DISABLED" : ""}`).join("\n"));
  } catch (err) {
    return text(String(err instanceof Error ? err.message : err), true);
  }
});

server.tool(
  "create_post",
  "Publish or schedule posts through Postiz. Always needs a person's approval first. One entry per account, each with text written for that platform; images are workspace files (PNG/JPG). Instagram needs at least one image. Use when='draft' to put it into Postiz for a final look there.",
  {
    posts: z
      .array(
        z.object({
          channel_id: z.string().describe("Account id from list_channels"),
          text: z.string().min(1).describe("Post text for this platform"),
          images: z.array(z.string()).max(10).optional().describe("Workspace image files, e.g. social/2026-11-10/card-instagram.png"),
        }),
      )
      .min(1)
      .max(10),
    when: z.string().default("draft").describe('"now", "draft", or an ISO date-time for scheduling, e.g. 2026-11-10T09:00:00+04:00'),
  },
  async ({ posts, when }) => {
    try {
      const type = when === "now" ? "now" : when === "draft" ? "draft" : "schedule";
      const date = type === "schedule" ? new Date(when) : new Date();
      if (Number.isNaN(date.getTime())) return text(`when must be "now", "draft" or a date-time, got ${when}`, true);
      if (type === "schedule" && date.getTime() < Date.now() - 60_000) return text("The scheduled time is in the past.", true);
      const byId = new Map((await channels()).map((c) => [c.id, c]));
      const problems = [];
      for (const p of posts) {
        const ch = byId.get(p.channel_id);
        if (!ch) problems.push(`${p.channel_id}: not a connected account (call list_channels)`);
        else if (ch.disabled) problems.push(`${ch.name}: account is disabled in Postiz`);
        else if (LIMITS[ch.platform] && [...p.text].length > LIMITS[ch.platform]) problems.push(`${ch.name} (${ch.platform}): ${[...p.text].length} characters, limit ${LIMITS[ch.platform]}`);
        else if (ch.platform.startsWith("instagram") && !(p.images?.length > 0)) problems.push(`${ch.name}: Instagram needs at least one image`);
      }
      if (problems.length) return text(`Nothing was sent:\n- ${problems.join("\n- ")}`, true);

      const uploaded = new Map();
      for (const file of new Set(posts.flatMap((p) => p.images ?? []))) uploaded.set(file, await upload(file));
      const body = {
        type,
        date: date.toISOString(),
        shortLink: false,
        tags: [],
        posts: posts.map((p) => ({
          integration: { id: p.channel_id },
          value: [{ content: p.text, image: (p.images ?? []).map((f) => uploaded.get(f)) }],
          settings: settingsFor(byId.get(p.channel_id).platform),
        })),
      };
      const result = await postiz("/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const what = type === "now" ? "Published" : type === "draft" ? "Saved as drafts in Postiz" : `Scheduled for ${date.toISOString()}`;
      const names = posts.map((p) => `${byId.get(p.channel_id).platform} (${byId.get(p.channel_id).name})`).join(", ");
      return text(`${what}: ${names}.\nPostiz ids: ${JSON.stringify(result)}`);
    } catch (err) {
      return text(String(err instanceof Error ? err.message : err), true);
    }
  },
);

await server.connect(new StdioServerTransport());
