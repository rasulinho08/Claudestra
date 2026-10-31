import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { t } from "../i18n.ts";

type Server = { id: string; description: string; type: string; status: "ready" | "missing_secret" | "invalid"; missing: string[]; readTools: string[]; usedBy: string[] };

// Integrations (MCP apps, docs/05 "Integrations"): configured in integrations.json, secrets from .env.
export function AppsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ error?: string; servers: Server[] }>("/api/integrations")
      .then((r) => {
        setServers(r.servers);
        if (r.error) setError(r.error);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  return (
    <div className="page-scroll">
      <div className="page-narrow">
        <h2>{t("page.apps")}</h2>
        <p className="muted small">
          Apps are MCP servers listed in <code>integrations.json</code> (copy <code>integrations.example.json</code>). Values like <code>{"${GITHUB_TOKEN}"}</code> come from
          your <code>.env</code>, so no secret is stored in the file. An agent gets an app by listing it in its <code>integrations</code>, for example{" "}
          <code>"github:search_*"</code> for read-only search tools. Write tools (create, update, delete, push, merge) always ask for approval, even in auto mode.
        </p>
        {error && <div className="error small">{error}</div>}
        {servers.length === 0 && <p className="muted">No integrations configured.</p>}
        <div className="app-grid">
          {servers.map((s) => (
            <div key={s.id} className={`app-card app-${s.status}`}>
              <div className="lib-head">
                <strong>⧉ {s.id}</strong>
                <span className={`chip ${s.status === "ready" ? "chip-ok" : "chip-warn"}`}>{s.status === "ready" ? "ready" : s.status === "missing_secret" ? "needs secret" : "invalid"}</span>
              </div>
              <div className="small muted">{s.description}</div>
              <div className="small">
                {s.type} · used by {s.usedBy.length ? s.usedBy.join(", ") : "no agent yet"}
              </div>
              {s.missing.length > 0 && (
                <div className="small denied">
                  Add to .env: {s.missing.map((m) => <code key={m}>{m}=…</code>)}
                </div>
              )}
              {s.readTools.length > 0 && (
                <div className="tags">
                  {s.readTools.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
