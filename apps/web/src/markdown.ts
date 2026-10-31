// Small Markdown parser for agent answers (docs/07 "Results"). Produces a tree that Markdown.tsx renders as React
// elements, so no HTML from the model is ever injected. Covers what models write: headings, paragraphs, lists
// (nested by indent), code fences, quotes, tables, rules, bold/italic/strike, inline code and links.

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type ListItem = { c: Inline[]; checked?: boolean; sub: Block[] };
export type Block =
  | { t: "h"; level: number; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "table"; head: Inline[][]; align: ("left" | "center" | "right" | null)[]; rows: Inline[][][] }
  | { t: "hr" };

// Only web and mail links become clickable; anything else (javascript:, data:) stays text.
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:|mailto:)/i.test(h) ? h : null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  // Plain runs are copied in one go; pattern checks start only at special characters and look at most 4000
  // characters ahead, so long text stays linear.
  const special = (k: number) => "\\`*_~[<\n".includes(src[k]!) || (src[k] === "h" && src.startsWith("http", k));
  let i = 0;
  while (i < src.length) {
    if (!special(i)) {
      let j = i + 1;
      while (j < src.length && !special(j)) j++;
      text += src.slice(i, j);
      i = j;
      continue;
    }
    const rest = src.slice(i, i + 4000);
    let m: RegExpExecArray | null;
    if (rest[0] === "\\" && /^\\[\\`*_~[\]()#+\-.!|>]/.test(rest)) {
      text += rest[1];
      i += 2;
      continue;
    }
    if ((m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) {
      flush();
      out.push({ t: "code", v: m[2]!.replace(/^ (.*) $/, "$1") });
      i += m[0].length;
      continue;
    }
    if ((m = /^\[([^\]]*)\]\(\s*<?((?:[^()\s>]|\([^()\s]*\))+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
      const href = safeHref(m[2]!);
      flush();
      if (href) out.push({ t: "link", href, c: parseInline(m[1]!) });
      else out.push(...parseInline(m[1]!));
      i += m[0].length;
      continue;
    }
    if ((m = /^<(https?:\/\/[^\s>]+)>/.exec(rest)) || (m = /^(https?:\/\/[^\s<]*[^\s<.,;:!?\]'"*_])/.exec(rest))) {
      if (!/\w$/.test(text)) {
        let url = m[1]!;
        let used = m[0].length;
        // Drop closing parentheses that belong to the sentence, keep balanced ones (Wikipedia links).
        while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
          url = url.slice(0, -1);
          used--;
        }
        flush();
        out.push({ t: "link", href: url, c: [{ t: "text", v: url }] });
        i += used;
        continue;
      }
    }
    if ((m = /^\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/.exec(rest))) {
      flush();
      out.push({ t: "strong", c: [{ t: "em", c: parseInline(m[1]!) }] });
      i += m[0].length;
      continue;
    }
    if ((m = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest)) || (!/\w$/.test(text) && (m = /^__(?=\S)([\s\S]*?\S)__(?!\w)/.exec(rest)))) {
      flush();
      out.push({ t: "strong", c: parseInline(m[1]!) });
      i += m[0].length;
      continue;
    }
    if ((m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) {
      flush();
      out.push({ t: "del", c: parseInline(m[1]!) });
      i += m[0].length;
      continue;
    }
    // _emphasis_ only at word boundaries, so snake_case names stay intact.
    if ((m = /^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/.exec(rest)) || (!/\w$/.test(text) && (m = /^_(?=\S)([\s\S]*?\S)_(?!\w)/.exec(rest)))) {
      flush();
      out.push({ t: "em", c: parseInline(m[1]!) });
      i += m[0].length;
      continue;
    }
    if (rest[0] === "\n") {
      if (/ {2,}$/.test(text) || text.endsWith("\\")) {
        text = text.replace(/(?: {2,}|\\)$/, "");
        flush();
        out.push({ t: "br" });
      } else text += " ";
      i++;
      continue;
    }
    text += rest[0];
    i++;
  }
  flush();
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || HR.test(line) || LIST.test(line) || QUOTE.test(line);

export function parseMarkdown(src: string): Block[] {
  return parseLines(src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      i++;
      continue;
    }
    if ((m = FENCE.exec(line))) {
      const fence = m[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[i]!)) body.push(lines[i++]!);
      i++;
      blocks.push({ t: "code", lang: m[2] ?? "", v: body.join("\n") });
      continue;
    }
    if ((m = HEADING.exec(line))) {
      blocks.push({ t: "h", level: m[1]!.length, c: parseInline(m[2]!) });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim()) {
        const q = QUOTE.exec(lines[i]!);
        if (q) body.push(q[1]!);
        else if (!startsBlock(lines[i]!)) body.push(lines[i]!); // lazy continuation line
        else break;
        i++;
      }
      blocks.push({ t: "quote", c: parseLines(body) });
      continue;
    }
    if (LIST.test(line)) {
      const r = parseList(lines, i);
      blocks.push(r.block);
      i = r.next;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes("-")) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(cells(lines[i++]!).map(parseInline));
      blocks.push({ t: "table", head: head.map(parseInline), align, rows });
      continue;
    }
    const para: string[] = [];
    const tableStarts = (k: number) => lines[k]!.includes("|") && k + 1 < lines.length && TABLE_SEP.test(lines[k + 1]!) && lines[k + 1]!.includes("-");
    while (i < lines.length && lines[i]!.trim() && !(para.length > 0 && (startsBlock(lines[i]!) || tableStarts(i)))) para.push(lines[i++]!.replace(/^ {1,3}/, ""));
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = LIST.exec(lines[start]!)!;
  const indent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST.exec(lines[i]!);
    if (!m || m[1]!.length !== indent || /\d/.test(m[2]!) !== ordered) {
      // Blank line inside a list: continue if the next line is another item of this list.
      if (!lines[i]!.trim() && i + 1 < lines.length) {
        const n = LIST.exec(lines[i + 1]!);
        if (n && n[1]!.length === indent) {
          i++;
          continue;
        }
      }
      break;
    }
    const body = [m[3]!];
    const sub: string[] = [];
    i++;
    const contentIndent = indent + m[2]!.length + 1;
    while (i < lines.length) {
      const l = lines[i]!;
      const lm = LIST.exec(l);
      if (!l.trim()) {
        const next = lines[i + 1];
        if (next !== undefined && next.trim() && /^ */.exec(next)![0].length > indent && !(LIST.exec(next) && LIST.exec(next)![1]!.length <= indent)) {
          sub.push("");
          i++;
          continue;
        }
        break;
      }
      const lead = /^ */.exec(l)![0].length;
      if (lm && lm[1]!.length <= indent) break;
      if (lead > indent) sub.push(l.slice(Math.min(lead, contentIndent)));
      else if (sub.length === 0 && !startsBlock(l)) body.push(l.trim());
      else break;
      i++;
    }
    let text = body.join("\n");
    let checked: boolean | undefined;
    const task = /^\[([ xX])\]\s+/.exec(text);
    if (task) {
      checked = task[1] !== " ";
      text = text.slice(task[0].length);
    }
    items.push({ c: parseInline(text), checked, sub: sub.length ? parseLines(sub) : [] });
  }
  return { block: { t: "list", ordered, start: ordered ? parseInt(first[2]!, 10) : 1, items }, next: i };
}
