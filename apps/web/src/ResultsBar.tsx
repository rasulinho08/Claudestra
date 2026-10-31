// Results of a run (docs/07 "Results"): try the app, open the folder, download a ZIP, push to GitHub.
import { useEffect, useState } from "react";
import type { HealthResponse } from "@claudestra/protocol";
import { api, errorText } from "./api.ts";
import { t } from "./i18n.ts";

type Entry = { path: string };
type Export = { repo: string; url: string; commit: string; at: string };

// The preview opens under the other loopback name (127.0.0.1 <-> localhost) so it is a different site from the app:
// separate cookies and storage. Deployed setups set PREVIEW_URL to a host of their own.
export function previewBase(health: HealthResponse | null, loc: { protocol: string; hostname: string } = window.location): string | null {
  const r = health?.results;
  if (!r) return null;
  if (r.previewUrl) return r.previewUrl;
  if (!r.previewPort) return null;
  const host = loc.hostname === "127.0.0.1" ? "localhost" : loc.hostname === "localhost" ? "127.0.0.1" : loc.hostname;
  return `${loc.protocol}//${host}:${r.previewPort}`;
}

// The page to try first: index.html at the top level, else the shallowest HTML file.
export function entryPage(files: string[]): string | null {
  const html = files.filter((f) => /\.html?$/i.test(f) && !f.startsWith(".claudestra/") && !/(^|\/)node_modules\//.test(f));
  if (html.length === 0) return null;
  const depth = (f: string) => f.split("/").length;
  return [...html].sort((a, b) => Number(!/(^|\/)index\.html?$/i.test(a)) - Number(!/(^|\/)index\.html?$/i.test(b)) || depth(a) - depth(b) || a.localeCompare(b))[0]!;
}

export function slugFor(prompt: string): string {
  const map: Record<string, string> = { ə: "e", ı: "i", ö: "o", ü: "u", ş: "s", ç: "c", ğ: "g" };
  const s = prompt
    .toLocaleLowerCase("az")
    .replace(/[əıöüşçğ]/g, (c) => map[c] ?? c)
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "claudestra-project";
}

export function ResultsBar({ runId, prompt, health, refreshKey }: { runId: string; prompt: string; health: HealthResponse | null; refreshKey: number }) {
  const [files, setFiles] = useState<string[]>([]);
  const [note, setNote] = useState<{ text: string; error?: boolean; href?: string } | null>(null);
  const [github, setGithub] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    api<Entry[]>(`/api/runs/${runId}/files`)
      .then((f) => setFiles(f.map((e) => e.path)))
      .catch(() => setFiles([]));
  }, [runId, refreshKey]);
  useEffect(() => {
    setNote(null);
    setPreview(null);
  }, [runId]);

  const results = health?.results;
  const page = entryPage(files);
  const base = previewBase(health);
  const canPreview = Boolean(base);
  const hasFiles = files.some((f) => !f.startsWith(".claudestra/"));
  if (!hasFiles) return null;

  async function openFolder() {
    try {
      const r = await api<{ path: string }>(`/api/runs/${runId}/open-folder`, { body: {} });
      setNote({ text: t("results.opened", { path: r.path }) });
    } catch (err) {
      setNote({ text: errorText(err), error: true });
    }
  }

  return (
    <div className="results-bar">
      {page && (
        <button className="btn-ok" disabled={!canPreview} title={canPreview ? t("results.tryTitle", { page }) : t("results.previewOff")} onClick={() => setPreview(page)}>
          ▶ {t("results.try")}
        </button>
      )}
      {results?.openFolder && (
        <button className="ghost" onClick={openFolder} title={t("results.folderTitle")}>
          📁 {t("results.folder")}
        </button>
      )}
      <a className="ghost button-like" href={`/api/runs/${runId}/zip`} download title={t("results.zipTitle")}>
        ⬇ {t("results.zip")}
      </a>
      <button className="ghost" onClick={() => setGithub(true)} title={results?.github ? t("results.githubTitle") : t("results.githubOff")}>
        ⬆ {t("results.github")}
      </button>
      {note && (
        <span className={`small ${note.error ? "error" : "muted"}`}>
          {note.text}{" "}
          {note.href && (
            <a href={note.href} target="_blank" rel="noopener noreferrer">
              {note.href}
            </a>
          )}
        </span>
      )}
      {preview && base && <PreviewModal base={base} runId={runId} page={preview} pages={htmlPages(files)} onPage={setPreview} onClose={() => setPreview(null)} />}
      {github && (
        <GitHubDialog
          runId={runId}
          prompt={prompt}
          enabled={Boolean(results?.github)}
          onClose={() => setGithub(false)}
          onDone={(url) => {
            setGithub(false);
            setNote({ text: t("results.pushed"), href: url });
          }}
        />
      )}
    </div>
  );
}

function GitHubDialog({ runId, prompt, enabled, onClose, onDone }: { runId: string; prompt: string; enabled: boolean; onClose: () => void; onDone: (url: string) => void }) {
  const [repo, setRepo] = useState(`${slugFor(prompt)}`);
  const [priv, setPriv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Export | null>(null);

  useEffect(() => {
    api<Export[]>(`/api/runs/${runId}/exports`)
      .then((rows) => {
        if (rows[0]) {
          setLast(rows[0]);
          setRepo(rows[0].repo);
        }
      })
      .catch(() => {});
  }, [runId]);

  async function push() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ url: string }>(`/api/runs/${runId}/github`, { body: { repo, private: priv } });
      onDone(r.url);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal">
        <h3>{t("gh.title")}</h3>
        {!enabled ? (
          <>
            <p className="muted">{t("gh.noToken")}</p>
            <pre className="code">GITHUB_TOKEN=github_pat_...</pre>
            <p className="small muted">{t("gh.tokenHelp")}</p>
          </>
        ) : (
          <>
            <label className="field">
              <span className="small muted">{t("gh.repo")}</span>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="my-app or owner/my-app" disabled={busy} />
            </label>
            <label className="small">
              <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} disabled={busy} /> {t("gh.private")}
            </label>
            <p className="small muted">{t("gh.explain")}</p>
            {last && (
              <p className="small muted">
                {t("gh.last")}{" "}
                <a href={last.url} target="_blank" rel="noopener noreferrer">
                  {last.repo}
                </a>
              </p>
            )}
            {error && <div className="error small">{error}</div>}
          </>
        )}
        <div className="approval-actions">
          {enabled && (
            <button className="btn-ok" onClick={push} disabled={busy || !repo.trim()}>
              {busy ? t("gh.pushing") : t("gh.push")}
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

export function PreviewModal({ base, runId, page, pages, onPage, onClose }: { base: string; runId: string; page: string; pages: string[]; onPage: (p: string) => void; onClose: () => void }) {
  const [nonce, setNonce] = useState(0);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ path: string }>(`/api/runs/${runId}/preview`)
      .then((r) => setLink(r.path))
      .catch((e) => setError(errorText(e)));
  }, [runId]);
  const src = link ? `${base}${link}${page.split("/").map(encodeURIComponent).join("/")}` : "about:blank";
  // allow-same-origin is only safe because the preview lives on another origin; never grant it on the app's own.
  const separate = (() => {
    try {
      return new URL(base).origin !== window.location.origin;
    } catch {
      return false;
    }
  })();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop preview-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="preview">
        <div className="preview-bar">
          <strong>▶ {t("results.try")}</strong>
          {pages.length > 1 ? (
            <select value={page} onChange={(e) => onPage(e.target.value)}>
              {pages.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          ) : (
            <code className="small">{page}</code>
          )}
          <button className="ghost" onClick={() => setNonce(nonce + 1)} title={t("preview.reload")}>
            ⟳
          </button>
          <a className="ghost button-like" href={link ? src : undefined} target="_blank" rel="noopener noreferrer">
            ↗ {t("preview.newTab")}
          </a>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        {/* Another origin (the preview port): the page gets its own storage and cannot touch Claudestra. */}
        {error && <div className="error small preview-error">{error}</div>}
        <iframe key={nonce} title="preview" src={src} sandbox={`allow-scripts allow-forms allow-modals allow-popups allow-downloads${separate ? " allow-same-origin" : ""}`} />
      </div>
    </div>
  );
}

export const htmlPages = (files: string[]) => files.filter((f) => /\.html?$/i.test(f) && !f.startsWith(".claudestra/"));
