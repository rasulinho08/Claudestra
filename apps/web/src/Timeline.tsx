import type { TimelineItem } from "./run-state.ts";
import { t } from "./i18n.ts";

export type Decide = (approvalId: string, decision: "approve" | "approve_run" | "reject") => void;

export function Timeline({ items, onDecide }: { items: TimelineItem[]; onDecide?: Decide }) {
  if (items.length === 0) return <p className="muted small">{t("tl.nothing")}</p>;
  return (
    <div className="timeline">
      {items.map((item) => (
        <Item key={`${item.kind}-${item.id}`} item={item} onDecide={onDecide} />
      ))}
    </div>
  );
}

function Item({ item, onDecide }: { item: TimelineItem; onDecide?: Decide }) {
  switch (item.kind) {
    case "message":
      return <div className={`msg msg-${item.role} ${item.streaming ? "streaming" : ""}`}>{item.text}</div>;
    case "thinking":
      return (
        <details className="card thinking">
          <summary>{t("tl.thinking")}</summary>
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
          <ToolInput tool={item.tool} input={item.input} />
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
          <summary>{t("tl.inputFrom", { id: item.from })}</summary>
          <pre>{item.summary}</pre>
        </details>
      );
    case "approval":
      return (
        <div className={`card approval approval-${item.state}`}>
          <div>
            <strong>{item.state === "pending" ? t("tl.needsApproval") : item.state === "approved" ? t("tl.approved") : t("tl.rejected")}</strong>
            {item.tool && <span className="muted small"> · {item.tool}</span>}
            {item.by && item.by !== "user" && <span className="muted small"> · {item.by === "auto" ? t("tl.autoApproved") : t("tl.ruleApproved")}</span>}
            {item.scope === "run" && <span className="muted small"> · {t("tl.forRun")}</span>}
          </div>
          {item.input !== undefined && <pre>{preview(item.input, 400)}</pre>}
          {item.reason && <div className="small muted">{item.reason}</div>}
          {item.note && <div className="small">{t("tl.note", { text: item.note })}</div>}
          {item.state === "pending" && onDecide && <ApprovalButtons onDecide={(d) => onDecide(item.id, d)} />}
        </div>
      );
    case "note":
      return <div className="note small">{item.text}</div>;
    case "artifact":
      return (
        <div className="artifact small">
          📄 {item.title}: <code>{item.path}</code>
        </div>
      );
    case "denied":
      return (
        <div className="denied small">
          {t("tl.denied", { tool: item.tool, reason: item.reason })}
        </div>
      );
    case "error":
      return <div className="error">{item.text}</div>;
  }
}

export function ApprovalButtons({ onDecide, allowRun = true }: { onDecide: (d: "approve" | "approve_run" | "reject") => void; allowRun?: boolean }) {
  return (
    <div className="approval-actions">
      <button className="btn-ok" onClick={() => onDecide("approve")}>
        {t("approval.approve")}
      </button>
      {allowRun && (
        <button className="ghost" onClick={() => onDecide("approve_run")} title={t("approval.approveRunTitle")}>
          {t("approval.approveRun")}
        </button>
      )}
      <button className="btn-bad" onClick={() => onDecide("reject")}>
        {t("approval.reject")}
      </button>
    </div>
  );
}

// Edits render as a small before/after diff; writes show the new file.
function ToolInput({ tool, input }: { tool: string; input: unknown }) {
  const i = (input ?? {}) as Record<string, unknown>;
  if (tool === "Edit" && typeof i.old_string === "string" && typeof i.new_string === "string") {
    return (
      <div className="diff">
        <div className="small muted">{shortPath(String(i.file_path ?? ""))}</div>
        <pre className="diff-del">{prefix(i.old_string, "- ")}</pre>
        <pre className="diff-add">{prefix(i.new_string, "+ ")}</pre>
      </div>
    );
  }
  if (tool === "Write" && typeof i.content === "string") {
    return (
      <div className="diff">
        <div className="small muted">{shortPath(String(i.file_path ?? ""))} {t("tl.newContent")}</div>
        <pre className="diff-add">{i.content.length > 4000 ? `${i.content.slice(0, 4000)}\n…` : i.content}</pre>
      </div>
    );
  }
  return <pre>{JSON.stringify(input, null, 2)}</pre>;
}

const prefix = (text: string, p: string) =>
  text
    .split("\n")
    .map((l) => p + l)
    .join("\n");

export const shortPath = (p: string) => (p.includes("/workspaces/") ? p.replace(/^.*\/workspaces\/[^/]+\//, "") : p);

function preview(input: unknown, max = 50): string {
  if (!input || typeof input !== "object") return "";
  const first = Object.values(input as Record<string, unknown>).find((v) => typeof v === "string") as string | undefined;
  if (!first) return "";
  const short = shortPath(first);
  return short.length > max ? `${short.slice(0, max)}…` : short;
}
