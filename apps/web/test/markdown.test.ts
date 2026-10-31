import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown, safeHref } from "../src/markdown.ts";
import { entryPage, previewBase, slugFor } from "../src/ResultsBar.tsx";

test("markdown: headings, lists with nesting and tasks, code, tables, quotes", () => {
  const md = [
    "# Title",
    "",
    "Some **bold** and *em* and `code` text,",
    "continued line.",
    "",
    "- one",
    "  - nested",
    "- [x] done",
    "",
    "1. first",
    "2. second",
    "",
    "```js",
    "const a = 1 * 2;",
    "```",
    "",
    "| Name | Cost |",
    "|:-----|-----:|",
    "| a | $1 |",
    "",
    "> quoted",
    "lazy",
    "",
    "---",
  ].join("\n");
  const b = parseMarkdown(md);
  assert.deepEqual(b.map((x) => x.t), ["h", "p", "list", "list", "code", "table", "quote", "hr"]);
  const ul = b[2] as Extract<(typeof b)[number], { t: "list" }>;
  assert.equal(ul.items.length, 2);
  assert.equal(ul.items[0]!.sub[0]!.t, "list");
  assert.equal(ul.items[1]!.checked, true);
  const ol = b[3] as Extract<(typeof b)[number], { t: "list" }>;
  assert.equal(ol.ordered, true);
  assert.equal(ol.items.length, 2);
  assert.deepEqual(b[4], { t: "code", lang: "js", v: "const a = 1 * 2;" });
  const table = b[5] as Extract<(typeof b)[number], { t: "table" }>;
  assert.deepEqual(table.align, ["left", "right"]);
  assert.equal(table.rows.length, 1);
  const p = b[1] as Extract<(typeof b)[number], { t: "p" }>;
  assert.deepEqual(p.c.map((n) => n.t), ["text", "strong", "text", "em", "text", "code", "text"]);
});

test("markdown: links are only http(s)/mailto; snake_case and bare URLs survive", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref(" https://x.y "), "https://x.y");
  const bad = parseInline("[click](javascript:alert(1))");
  assert.ok(bad.every((n) => n.t !== "link"));
  const good = parseInline("see [docs](https://example.com/a_b) and https://ynab.com/features.");
  const links = good.filter((n) => n.t === "link") as { href: string }[];
  assert.deepEqual(links.map((l) => l.href), ["https://example.com/a_b", "https://ynab.com/features"]);
  assert.deepEqual(parseInline("totals_by_category.csv"), [{ t: "text", v: "totals_by_category.csv" }]);
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ t: "text", v: "2 * 3 * 4" }]);
});

test("results: entry page and repo slug", () => {
  assert.equal(entryPage(["app.js", "pages/about.html", "index.html"]), "index.html");
  assert.equal(entryPage(["site/index.html", "other.html"]), "site/index.html");
  assert.equal(entryPage(["deep/a/b.html", "c.html"]), "c.html");
  assert.equal(entryPage([".claudestra/report.html", "x.js"]), null);
  assert.equal(slugFor("Kiçik bir Xərc izləyici"), "kicik-bir-xerc-izleyici");
  const health = (results: object) => ({ results }) as Parameters<typeof previewBase>[0];
  const r = { previewPort: 8788, previewUrl: null, openFolder: true, github: false };
  assert.equal(previewBase(health(r), { protocol: "http:", hostname: "127.0.0.1" }), "http://localhost:8788");
  assert.equal(previewBase(health(r), { protocol: "http:", hostname: "localhost" }), "http://127.0.0.1:8788");
  assert.equal(previewBase(health({ ...r, previewUrl: "https://preview.example" }), { protocol: "http:", hostname: "x" }), "https://preview.example");
  assert.equal(previewBase(health({ ...r, previewPort: null }), { protocol: "http:", hostname: "x" }), null);
});

test("markdown: review fixes (C# headings, bold italic, parentheses in URLs, table after text, __init__, long text)", () => {
  assert.deepEqual(parseMarkdown("## Using C#")[0], { t: "h", level: 2, c: [{ t: "text", v: "Using C#" }] });
  assert.deepEqual(parseMarkdown("## Title ##")[0], { t: "h", level: 2, c: [{ t: "text", v: "Title" }] });
  assert.deepEqual(parseInline("***x***"), [{ t: "strong", c: [{ t: "em", c: [{ t: "text", v: "x" }] }] }]);
  const wiki = parseInline("[wiki](https://en.wikipedia.org/wiki/Baku_(city)) and (see https://en.wikipedia.org/wiki/Baku_(city))");
  const hrefs = wiki.filter((n) => n.t === "link").map((n) => (n as { href: string }).href);
  assert.deepEqual(hrefs, ["https://en.wikipedia.org/wiki/Baku_(city)", "https://en.wikipedia.org/wiki/Baku_(city)"]);
  assert.equal((wiki[wiki.length - 1] as { v: string }).v, ")");
  assert.deepEqual(parseMarkdown("Here:\n| a | b |\n|---|---|\n| 1 | 2 |").map((b) => b.t), ["p", "table"]);
  assert.deepEqual(parseInline("call __init__ and foo__bar__baz"), [{ t: "text", v: "call " }, { t: "strong", c: [{ t: "text", v: "init" }] }, { t: "text", v: " and foo__bar__baz" }]);
  const long = "word *x ".repeat(20000);
  const t0 = Date.now();
  parseInline(long);
  assert.ok(Date.now() - t0 < 1500, "linear-ish on long text");
});
