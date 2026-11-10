// Attachments (docs/19): a paperclip that uploads the chosen files at once and remembers the upload id until the
// task is sent. The files end up in the run's workspace under inputs/.
import { useRef, useState } from "react";
import { ApiError } from "./api.ts";
import { t } from "./i18n.ts";

export type Attached = { id: string; files: { name: string; bytes: number }[] } | null;

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export async function uploadFiles(files: File[]): Promise<NonNullable<Attached>> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status, data as Record<string, unknown>);
  return data as unknown as NonNullable<Attached>;
}

// The button; `value` and `onChange` keep the attached batch in the composer's state.
export function AttachButton({ value, onChange, disabled }: { value: Attached; onChange: (next: Attached) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadFiles([...list]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      onChange(null);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span className="attach-wrap">
      <input ref={input} type="file" multiple hidden onChange={(e) => void pick(e.target.files)} />
      <button type="button" className={`mic-btn attach-btn ${value ? "has" : ""}`} onClick={() => input.current?.click()} disabled={disabled || busy} title={t("attach.add")} aria-label={t("attach.add")}>
        {busy ? "…" : "📎"}
      </button>
      {error && (
        <span className="mic-live small error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

// The chips that show what is attached, with a way to remove it.
export function AttachedFiles({ value, onClear }: { value: Attached; onClear: () => void }) {
  if (!value) return null;
  return (
    <div className="attached" aria-label={t("attach.list")}>
      {value.files.map((f) => (
        <span key={f.name} className="chip attached-chip" title={`${f.name} · ${size(f.bytes)}`}>
          📄 {f.name} <span className="muted">{size(f.bytes)}</span>
        </span>
      ))}
      <button type="button" className="linkish small" onClick={onClear}>
        ✕ {t("attach.remove")}
      </button>
    </div>
  );
}
