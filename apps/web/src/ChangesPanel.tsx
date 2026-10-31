// Changes of a project run (upgrade A3): what the run added, modified or deleted compared with the project files it
// started from, a small line diff per file, and Apply / Undo. The apply result arrives as a project.applied event.
import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "./api.ts";
import { t } from "./i18n.ts";
import type { RunView } from "./run-state.ts";

type Change = { path: string; kind: "added" | "modified" | "deleted"; conflict: boolean; binary: boolean; before?: string; after?: string; bytes: number };
type Changes = { project: { id: string; name: string; path: string } | null; appliedAt: string | null; undoneAt: string | null; changes: Change[] };

// Line diff (LCS) for small files; falls back to "before / after" blocks for big ones.
export function lineDiff(before: string, after: string): { kind: " " | "+" | "-"; text: string }[] | null {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 400_000) return null;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { kind: " " | "+" | "-"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: " ", text: a[i++]! }), j++;
    else if (i < a.length && (j >= b.length || dp[i + 1]![j]! >= dp[i]![j + 1]!)) out.push({ kind: "-", text: a[i++]! });
    else out.push({ kind: "+", text: b[j++]! });
  }
  // Keep 2 lines of context around changes.
  const result: { kind: " " | "+" | "-"; text: string }[] = [];
  out.forEach((l, k) => {
    const near = out.slice(Math.max(0, k - 2), k + 3).some((x) => x.kind !== " ");
    if (near) result.push(l);
    else if (result[result.length - 1]?.text !== "…") result.push({ kind: " ", text: "…" });
  });
  return result;
}

export function ChangesButton({ run, runId }: { run: RunView; runId: string }) {
  const [open, setOpen] = useState(false);
  if (!run.project || run.status === "running" || run.status === "connecting") return null;
  const label = run.applied && !run.applied.undone ? `✓ ${t("changes.applied")}` : `⇄ ${t("changes.button")}`;
  return (
    <>
      <button className={run.applied && !run.applied.undone ? "ghost" : "btn-ok"} onClick={() => setOpen(true)} title={t("changes.title", { name: run.project.name })}>
        {label}
      </button>
      {open && <ChangesModal runId={runId} run={run} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangesModal({ runId, run, onClose }: { runId: string; run: RunView; onClose: () => void }) {
  const [data, setData] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = () =>
    api<Changes>(`/api/runs/${runId}/changes`)
      .then((d) => {
        setData(d);
        setSelected(new Set(d.changes.filter((c) => !c.conflict).map((c) => c.path)));
        setOpenFile((f) => f ?? d.changes[0]?.path ?? null);
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, run.applied?.undone, run.applied?.applied]);

  const applied = Boolean(data?.appliedAt && !data.undoneAt);
  const current = data?.changes.find((c) => c.path === openFile);
  const diff = useMemo(() => (current && !current.binary && current.kind === "modified" && current.before !== undefined && current.after !== undefined ? lineDiff(current.before, current.after) : null), [current]);

  async function apply() {
    if (!data) return;
    const conflicts = data.changes.filter((c) => c.conflict && selected.has(c.path));
    if (conflicts.length && !window.confirm(t("changes.confirmConflicts", { n: conflicts.length }))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ applied: string[]; skipped: { path: string; reason: string }[] }>(`/api/runs/${runId}/apply`, { body: { paths: [...selected], force: conflicts.length > 0 } });
      setResult(t("changes.done", { n: r.applied.length, name: data.project?.name ?? "" }) + (r.skipped.length ? ` ${t("changes.skipped", { n: r.skipped.length })}` : ""));
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      let r = await api<{ restored: number; skipped: string[] }>(`/api/runs/${runId}/undo-apply`, { body: {} });
      if (r.skipped.length && window.confirm(t("changes.undoConflicts", { n: r.skipped.length, files: r.skipped.slice(0, 8).join("\n") }))) {
        const forced = await api<{ restored: number; skipped: string[] }>(`/api/runs/${runId}/undo-apply`, { body: { force: true } });
        r = { restored: r.restored + forced.restored, skipped: forced.skipped };
      }
      setResult(t("changes.undoneMsg", { n: r.restored }) + (r.skipped.length ? ` ${t("changes.skipped", { n: r.skipped.length })}` : ""));
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal changes-modal">
        <h3>
          ⇄ {t("changes.title", { name: run.project?.name ?? "" })} <span className="muted small">{data?.project?.path}</span>
        </h3>
        {error && <div className="error small">{error}</div>}
        {result && <div className="small">{result}</div>}
        {!data ? (
          <p className="muted small">{t("files.loading")}</p>
        ) : data.changes.length === 0 ? (
          <p className="muted">{t("changes.none")}</p>
        ) : (
          <div className="changes-body">
            <div className="changes-list">
              {data.changes.map((c) => (
                <div key={c.path} className={`change-item ${openFile === c.path ? "active" : ""}`} onClick={() => setOpenFile(c.path)}>
                  <input
                    type="checkbox"
                    aria-label={c.path}
                    onClick={(e) => e.stopPropagation()}
                    disabled={applied}
                    checked={selected.has(c.path)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.path);
                      else next.delete(c.path);
                      setSelected(next);
                    }}
                  />
                  <span className={`change-kind kind-${c.kind}`}>{c.kind === "added" ? "+" : c.kind === "deleted" ? "−" : "~"}</span>
                  <span className="change-path">{c.path}</span>
                  {c.conflict && <span className="chip chip-warn" title={t("changes.conflictHelp")}>{t("changes.conflict")}</span>}
                </div>
              ))}
            </div>
            <div className="changes-view">
              {!current ? null : current.binary ? (
                <p className="muted small">{t("files.binary")}</p>
              ) : current.kind === "deleted" ? (
                <p className="muted small">{t("changes.deleted")}</p>
              ) : current.kind === "added" ? (
                <pre className="diff-add">{current.after ?? ""}</pre>
              ) : diff ? (
                <pre className="diff">
                  {diff.map((l, k) => (
                    <div key={k} className={l.kind === "+" ? "diff-add" : l.kind === "-" ? "diff-del" : "diff-ctx"}>
                      {l.kind} {l.text}
                    </div>
                  ))}
                </pre>
              ) : (
                <>
                  <pre className="diff-del">{current.before}</pre>
                  <pre className="diff-add">{current.after}</pre>
                </>
              )}
            </div>
          </div>
        )}
        <div className="approval-actions">
          {data && data.changes.length > 0 && !applied && (
            <button className="btn-ok" onClick={apply} disabled={busy || selected.size === 0}>
              {t("changes.apply", { n: selected.size })}
            </button>
          )}
          {applied && (
            <button className="ghost" onClick={undo} disabled={busy}>
              ↶ {t("changes.undo")}
            </button>
          )}
          <button className="ghost" onClick={onClose} disabled={busy}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
