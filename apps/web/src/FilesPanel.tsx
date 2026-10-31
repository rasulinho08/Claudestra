import { useEffect, useState } from "react";
import { api, errorText } from "./api.ts";
import { t } from "./i18n.ts";

type Entry = { path: string; bytes: number; modified: string };

// Workspace browser for a run (docs/07 "Files"): list on top, content below.
export function FilesPanel({ runId, refreshKey }: { runId: string; refreshKey: number }) {
  const [files, setFiles] = useState<Entry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState<{ content: string; truncated: boolean; binary: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Entry[]>(`/api/runs/${runId}/files`).then(setFiles).catch((e) => setError(errorText(e)));
  }, [runId, refreshKey]);

  useEffect(() => {
    setContent(null);
    if (!open) return;
    api<{ content: string; truncated: boolean; binary: boolean }>(`/api/runs/${runId}/file?path=${encodeURIComponent(open)}`)
      .then(setContent)
      .catch((e) => setError(errorText(e)));
  }, [runId, open, refreshKey]);

  if (error) return <div className="error small">{error}</div>;
  if (files.length === 0) return <p className="muted small">{t("files.none")}</p>;
  return (
    <div className="files">
      <div className="file-list">
        {files.map((f) => (
          <button key={f.path} className={`file-item ${open === f.path ? "active" : ""}`} onClick={() => setOpen(f.path)}>
            <span>{f.path.startsWith(".claudestra/") ? "🗒 " : "📄 "}{f.path}</span>
            <span className="muted small">{f.bytes < 1024 ? `${f.bytes} B` : `${(f.bytes / 1024).toFixed(1)} KB`}</span>
          </button>
        ))}
      </div>
      {open && (
        <div className="file-view">
          <div className="small muted">{open}</div>
          {!content ? <p className="muted small">{t("files.loading")}</p> : content.binary ? <p className="muted small">{t("files.binary")}</p> : <pre className="code">{content.content}{content.truncated && "\n… [truncated]"}</pre>}
        </div>
      )}
    </div>
  );
}
