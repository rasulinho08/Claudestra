import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { t } from "../i18n.ts";

type Google = { configured: boolean; connected: boolean; email: string | null; connectedAt: string | null; redirectUri: string };
type Server = { id: string; description: string; type: string; status: "ready" | "missing_secret" | "invalid"; missing: string[]; readTools: string[]; usedBy: string[] };

// Integrations (MCP apps, docs/05 "Integrations"): configured in integrations.json, secrets from .env.
export function AppsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState<Google | null>(null);
  // After the Google sign-in the server sends the browser back here with ?google=connected or ?google=error:...
  const back = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("google");
  const loadGoogle = () => api<Google>("/api/google/status").then(setGoogle).catch(() => {});
  useEffect(() => {
    void loadGoogle();
  }, []);

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
        {google && (
          <section className={`google-card ${google.connected ? "on" : ""}`}>
            <div className="lib-head">
              <strong>🔗 {t("google.title")}</strong>
              <span className={`chip ${google.connected ? "chip-ok" : "chip-warn"}`}>{google.connected ? t("google.connected") : google.configured ? t("google.notConnected") : t("google.notSetUp")}</span>
            </div>
            <p className="small muted">{t("google.desc")}</p>
            {back === "connected" && <div className="small">✓ {t("google.justConnected")}</div>}
            {back?.startsWith("error:") && <div className="error small">{back.slice(6)}</div>}
            {google.connected ? (
              <div className="row-gap">
                <span className="small">
                  {t("google.account")}: <strong>{google.email ?? "?"}</strong>
                </span>
                <a className="ghost" href="/api/google/connect">
                  {t("google.reconnect")}
                </a>
                <button
                  className="ghost"
                  onClick={() => {
                    if (window.confirm(t("google.confirmOff"))) void api("/api/google", { method: "DELETE" }).then(loadGoogle);
                  }}
                >
                  {t("google.disconnect")}
                </button>
              </div>
            ) : google.configured ? (
              <div className="row-gap">
                <a className="hq-new" href="/api/google/connect">
                  {t("google.connect")}
                </a>
                <span className="small muted">{t("google.connectHint")}</span>
              </div>
            ) : (
              <ol className="small google-steps">
                <li>{t("google.step1")}</li>
                <li>{t("google.step2")}</li>
                <li>
                  {t("google.step3")} <code>{google.redirectUri}</code>
                </li>
                <li>
                  {t("google.step4")} <code>GOOGLE_CLIENT_ID=…</code> <code>GOOGLE_CLIENT_SECRET=…</code>
                </li>
                <li>{t("google.step5")}</li>
              </ol>
            )}
          </section>
        )}
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
