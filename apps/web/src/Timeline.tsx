import type { TimelineItem } from "./run-state.ts";

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <p className="muted small">Nothing yet.</p>;
  return (
    <div className="timeline">
      {items.map((item) => (
        <Item key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  );
}

function Item({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "message":
      return <div className={`msg msg-${item.role} ${item.streaming ? "streaming" : ""}`}>{item.text}</div>;
    case "thinking":
      return (
        <details className="card thinking">
          <summary>thinking</summary>
          <pre>{item.text}</pre>
        </details>
      );
    case "tool":
      return (
        <details className={`card tool ${item.result ? (item.result.ok ? "ok" : "fail") : "pending"}`}>
          <summary>
            <span className="tool-icon">{item.result ? (item.result.ok ? "✓" : "✗") : "…"}</span> {item.tool}
            <span className="muted small"> {preview(item.input)}</span>
          </summary>
          <pre>{JSON.stringify(item.input, null, 2)}</pre>
          {item.result && (
            <pre className="tool-output">
              {item.result.output}
              {item.result.truncated && "\n[truncated]"}
            </pre>
          )}
        </details>
      );
    case "handoff":
      return (
        <details className="card handoff">
          <summary>⇢ input from {item.from}</summary>
          <pre>{item.summary}</pre>
        </details>
      );
    case "artifact":
      return <div className="artifact small">📄 {item.title}: <code>{item.path}</code></div>;
    case "denied":
      return <div className="denied small">⛔ {item.tool} denied: {item.reason}</div>;
    case "error":
      return <div className="error">{item.text}</div>;
  }
}

function preview(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const first = Object.values(input as Record<string, unknown>).find((v) => typeof v === "string") as string | undefined;
  if (!first) return "";
  const short = first.includes("/workspaces/") ? first.replace(/^.*\/workspaces\/[^/]+\//, "") : first;
  return short.length > 50 ? `${short.slice(0, 50)}…` : short;
}
