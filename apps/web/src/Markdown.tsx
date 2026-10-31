import { memo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "./markdown.ts";

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "strong":
        return <strong key={i}>{inline(n.c)}</strong>;
      case "em":
        return <em key={i}>{inline(n.c)}</em>;
      case "del":
        return <del key={i}>{inline(n.c)}</del>;
      case "code":
        return <code key={i}>{n.v}</code>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {inline(n.c)}
          </a>
        );
      case "br":
        return <br key={i} />;
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "h": {
      const Tag = `h${Math.min(6, b.level + 1)}` as "h2";
      return <Tag key={i}>{inline(b.c)}</Tag>;
    }
    case "p":
      return <p key={i}>{inline(b.c)}</p>;
    case "code":
      return (
        <pre key={i} className="code" data-lang={b.lang || undefined}>
          <code>{b.v}</code>
        </pre>
      );
    case "quote":
      return <blockquote key={i}>{b.c.map(block)}</blockquote>;
    case "hr":
      return <hr key={i} />;
    case "list": {
      const items = b.items.map((it, j) => (
        <li key={j} className={it.checked !== undefined ? "task" : undefined}>
          {it.checked !== undefined && <input type="checkbox" checked={it.checked} readOnly disabled />}
          {inline(it.c)}
          {it.sub.map(block)}
        </li>
      ));
      return b.ordered ? (
        <ol key={i} start={b.start !== 1 ? b.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={i}>{items}</ul>
      );
    }
    case "table":
      return (
        <div key={i} className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, k) => (
                <tr key={k}>
                  {b.head.map((_, j) => (
                    <td key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                      {inline(r[j] ?? [])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// Rendered Markdown; never injects HTML (see markdown.ts).
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`md ${className ?? ""}`}>{parseMarkdown(text).map(block)}</div>;
});
