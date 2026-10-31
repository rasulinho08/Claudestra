import { useEffect, useState } from "react";
import { api, errorText } from "./api.ts";
import type { HealthResponse } from "@claudestra/protocol";
import { t } from "./i18n.ts";
import { Markdown } from "./Markdown.tsx";
import { PreviewModal, htmlPages, previewBase } from "./ResultsBar.tsx";

type Entry = { path: string; bytes: number; modified: string };

// Workspace browser for a run (docs/07 "Files"): list on top, content below.
export function FilesPanel({ runId, health, refreshKey }: { runId: string; health: HealthResponse | null; refreshKey: number }) {
  const [files, setFiles] = useState<Entry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState<{ content: string; truncated: boolean; binary: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const base = previewBase(health);

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
          <div className="file-head small muted">
            <span>{open}</span>
            {/\.html?$/i.test(open) && base && (
              <button className="ghost small" onClick={() => setPreview(open)}>
                ▶ {t("results.try")}
              </button>
            )}
            {/\.md$/i.test(open) && (
              <button className="ghost small" onClick={() => setRaw(!raw)}>
                {raw ? t("files.rendered") : t("files.raw")}
              </button>
            )}
          </div>
          {!content ? (
            <p className="muted small">{t("files.loading")}</p>
          ) : content.binary ? (
            <p className="muted small">{t("files.binary")}</p>
          ) : /\.md$/i.test(open) && !raw ? (
            <Markdown className="file-md" text={content.content} />
          ) : (
            <pre className="code">{content.content}{content.truncated && "\n… [truncated]"}</pre>
          )}
        </div>
      )}
      {preview && base && <PreviewModal base={base} runId={runId} page={preview} pages={htmlPages(files.map((f) => f.path))} onPage={setPreview} onClose={() => setPreview(null)} />}
    </div>
  );
}
