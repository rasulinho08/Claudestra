// Projects (upgrade A3): keep working on the same files. A project is a Claudestra folder or a real folder on this PC;
// each run starts from a copy of its files and its changes are applied back (with undo) from the run.
import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { go } from "../router.ts";
import { lang, t, type Key } from "../i18n.ts";

type ProjectRow = { id: string; name: string; folder: string | null; path: string; runs: number; lastRunAt: string | null; updatedAt: string };
type Detail = ProjectRow & {
  exists: boolean;
  files: { path: string; bytes: number }[];
  runs: { runId: string; prompt: string; status: string; startedAt: string; appliedAt: string | null; undoneAt: string | null }[];
};

const date = (iso: string) => new Date(iso).toLocaleString(lang() === "az" ? "az-AZ" : undefined, { dateStyle: "medium", timeStyle: "short" });

export function ProjectsPage({ initial }: { initial: string | null }) {
  const [list, setList] = useState<ProjectRow[]>([]);
  const [canLink, setCanLink] = useState(false);
  const [open, setOpen] = useState<string | null>(initial);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ projects: ProjectRow[]; canLinkFolders: boolean }>("/api/projects")
        .then((r) => {
          setList(r.projects);
          setCanLink(r.canLinkFolders);
        })
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setDetail(null);
    if (!open) return;
    api<Detail>(`/api/projects/${open}`)
      .then(setDetail)
      .catch((e) => setError(errorText(e)));
  }, [open]);

  async function create() {
    setError(null);
    try {
      const p = await api<ProjectRow>("/api/projects", { body: { name, folder: folder.trim() || undefined } });
      setCreating(false);
      setName("");
      setFolder("");
      await load();
      setOpen(p.id);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove() {
    if (!detail || !window.confirm(t(detail.folder ? "projects.confirmUnlink" : "projects.confirmDelete", { name: detail.name }))) return;
    try {
      await api(`/api/projects/${detail.id}${detail.folder ? "" : "?deleteFiles=1"}`, { method: "DELETE" });
      setOpen(null);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="lib-page">
      <div className="lib-list">
        <div className="lib-head">
          <h2>{t("nav.projects")}</h2>
          <button className="ghost" onClick={() => setCreating(true)}>
            + {t("projects.new")}
          </button>
        </div>
        <p className="small muted">{t("projects.intro")}</p>
        {creating && (
          <div className="lib-card project-form">
            <label className="field">
              <span className="small muted">{t("projects.name")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("projects.namePlaceholder")} autoFocus />
            </label>
            {canLink && (
              <label className="field">
                <span className="small muted">{t("projects.folder")}</span>
                <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\...\Documents\my-site" />
                <span className="small muted">{t("projects.folderHelp")}</span>
              </label>
            )}
            <div className="row-gap">
              <button className="ghost" onClick={() => setCreating(false)}>
                {t("common.close")}
              </button>
              <button onClick={create} disabled={!name.trim()}>
                {t("projects.create")}
              </button>
            </div>
          </div>
        )}
        {error && <div className="error small">{error}</div>}
        {list.length === 0 && !creating && <p className="muted small">{t("projects.none")}</p>}
        {list.map((p) => (
          <button key={p.id} className={`lib-card ${open === p.id ? "active" : ""}`} onClick={() => setOpen(p.id)}>
            <strong>📁 {p.name}</strong>
            <div className="small muted">{p.folder ?? t("projects.managed")}</div>
            <div className="small muted">{t("projects.runs", { n: p.runs })}</div>
          </button>
        ))}
      </div>
      <div className="lib-editor">
        {!detail ? (
          <p className="muted">{t("projects.pick")}</p>
        ) : (
          <>
            <div className="lib-head">
              <h3>📁 {detail.name}</h3>
              <div className="row-gap">
                <button className="ghost" onClick={remove}>
                  {detail.folder ? t("projects.unlink") : t("skills.delete")}
                </button>
                <button onClick={() => go("runs", { project: detail.id })}>+ {t("projects.newTask")}</button>
              </div>
            </div>
            <div className="small muted">
              <code>{detail.path}</code>
              {!detail.exists && <span className="error"> · {t("projects.missing")}</span>}
            </div>
            <h4>{t("projects.history")}</h4>
            {detail.runs.length === 0 ? (
              <p className="muted small">{t("projects.noRuns")}</p>
            ) : (
              <div className="project-runs">
                {detail.runs.map((r) => (
                  <a key={r.runId} className="hq-row" href={`#/runs?run=${r.runId}`}>
                    <span className={`dot dot-${r.status}`} />
                    <span className="hq-row-main">{r.prompt}</span>
                    <span className="small muted">
                      {t(`status.${r.status}` as Key)} · {date(r.startedAt)}
                      {r.appliedAt && !r.undoneAt ? ` · ✓ ${t("projects.applied")}` : r.undoneAt ? ` · ↶ ${t("projects.undone")}` : ""}
                    </span>
                  </a>
                ))}
              </div>
            )}
            <h4>
              {t("insp.files")} <span className="muted small">({detail.files.length})</span>
            </h4>
            {detail.files.length === 0 ? (
              <p className="muted small">{t("projects.empty")}</p>
            ) : (
              <div className="file-list">
                {detail.files.map((f) => (
                  <div key={f.path} className="file-item">
                    <span>📄 {f.path}</span>
                    <span className="muted small">{f.bytes < 1024 ? `${f.bytes} B` : `${(f.bytes / 1024).toFixed(1)} KB`}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
