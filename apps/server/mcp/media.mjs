// Built-in "media" MCP server (docs/16): turns an SVG card the agent wrote into a PNG that Instagram, LinkedIn and X
// accept, and optionally generates a picture with Google's Gemini image model (free tier, GEMINI_API_KEY).
// Plain JavaScript so it starts with `node` on every OS; files stay inside the run workspace.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { inWorkspace, rel, text, workspaceRoot } from "./workspace-path.mjs";

const MAX_IMAGES = Math.max(0, Number(process.env.MEDIA_MAX_IMAGES ?? 6) || 0);
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const GEMINI_BASE = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
let generated = 0;

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };

// Pictures inside the SVG (<image href="logo.png">) are inlined from the workspace before rendering, so the renderer
// never opens other files or the network. Paths are relative to the SVG file.
function inlineImages(svg, svgFile) {
  const base = path.dirname(svgFile);
  return svg.replace(/(\s(?:xlink:)?href\s*=\s*)(["'])(.*?)\2/g, (all, attr, q, href) => {
    if (href.startsWith("#") || href.startsWith("data:")) return all;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || path.isAbsolute(href)) throw new Error(`image ${href}: only files in the workspace can be used (save it there first)`);
    const file = inWorkspace(path.relative(workspaceRoot(), path.resolve(base, href)));
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`image ${href}: use PNG, JPG, WebP, GIF or SVG`);
    return `${attr}${q}data:${mime};base64,${readFileSync(file).toString("base64")}${q}`;
  });
}

const server = new McpServer({ name: "claudestra-media", version: "1.0.0" });

server.tool(
  "render_png",
  "Render an SVG file from the workspace to a PNG image (system fonts, Azerbaijani letters supported). Use it for post cards: write the SVG first, then render. Sizes: Instagram 1080x1080 or 1080x1350, LinkedIn/X 1200x627.",
  {
    svg_file: z.string().describe("SVG file in the workspace, e.g. social/2026-11-10/card.svg"),
    png_file: z.string().describe("Where to write the PNG, e.g. social/2026-11-10/card.png"),
    width: z.number().int().min(16).max(4096).optional().describe("Output width in pixels (default: the SVG's own width)"),
  },
  async ({ svg_file, png_file, width }) => {
    try {
      const { Resvg } = await import("@resvg/resvg-js");
      const source = inWorkspace(svg_file);
      const svg = inlineImages(readFileSync(source, "utf8"), source);
      const out = inWorkspace(png_file, { create: true });
      // Brand fonts can be dropped into a fonts/ folder of the workspace (or the linked project).
      const fonts = inWorkspace("fonts");
      const resvg = new Resvg(svg, {
        font: { loadSystemFonts: true, defaultFontFamily: "Arial", fontDirs: existsSync(fonts) ? [fonts] : [] },
        fitTo: width ? { mode: "width", value: width } : { mode: "original" },
      });
      const png = resvg.render();
      writeFileSync(out, png.asPng());
      return text(`PNG written: ${rel(out)} (${png.width}x${png.height})`);
    } catch (err) {
      return text(`render_png failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  },
);

server.tool(
  "generate_image",
  `Generate a picture with Google Gemini (${GEMINI_MODEL}) and save it in the workspace. For backgrounds and illustrations; put exact text, numbers and logos on an SVG card instead. Never put confidential information in the prompt (free-tier prompts may be used by Google). At most ${MAX_IMAGES} images per step.`,
  {
    prompt: z.string().min(3).describe("What the picture shows, style, colours; English works best"),
    image_file: z.string().describe("Where to save it, e.g. social/2026-11-10/background.png (extension follows the returned format)"),
    aspect_ratio: z.enum(["1:1", "4:5", "3:4", "16:9", "9:16", "4:3"]).optional().describe("Default 1:1"),
  },
  async ({ prompt, image_file, aspect_ratio }) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return text("generate_image is not set up: add GEMINI_API_KEY to .env (free key: aistudio.google.com/apikey). Use an SVG card with render_png instead.", true);
    if (generated >= MAX_IMAGES) return text(`Image limit reached (${MAX_IMAGES} per step, MEDIA_MAX_IMAGES).`, true);
    try {
      const res = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect_ratio ?? "1:1" } },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return text(`Gemini error ${res.status}: ${body?.error?.message ?? "request failed"}`, true);
      const parts = body?.candidates?.[0]?.content?.parts ?? [];
      const img = parts.map((p) => p.inlineData ?? p.inline_data).find((d) => d?.data);
      if (!img) {
        const said = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 300);
        return text(`Gemini returned no image${said ? `: ${said}` : ""}`, true);
      }
      generated++;
      const mime = img.mimeType ?? img.mime_type ?? "image/png";
      const ext = mime.includes("jpeg") ? ".jpg" : mime.includes("webp") ? ".webp" : ".png";
      const target = inWorkspace(image_file.replace(/\.(png|jpe?g|webp)$/i, "") + ext, { create: true });
      writeFileSync(target, Buffer.from(img.data, "base64"));
      return text(`Image saved: ${rel(target)} (${mime})`);
    } catch (err) {
      return text(`generate_image failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  },
);

await server.connect(new StdioServerTransport());
