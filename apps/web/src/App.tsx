import { useEffect, useState } from "react";
import type { HealthResponse, SessionInfo } from "@claudestra/protocol";
import { useRoute } from "./router.ts";
import { RunsPage } from "./RunsPage.tsx";
import { StagePage } from "./StagePage.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { SkillsPage } from "./pages/SkillsPage.tsx";
import { AppsPage } from "./pages/AppsPage.tsx";
import { WorkflowsPage } from "./pages/WorkflowsPage.tsx";
import { CostsPage } from "./pages/CostsPage.tsx";
import { MemoryPage } from "./pages/MemoryPage.tsx";
import { EvalsPage } from "./pages/EvalsPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { api } from "./api.ts";
import { lang, setLang, t } from "./i18n.ts";

const NAV = ["runs", "workflows", "agents", "skills", "apps", "memory", "evals", "costs", "users"] as const;

export function App() {
  const route = useRoute();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);

  const loadSession = () =>
    api<SessionInfo>("/api/session")
      .then(setSession)
      .catch(() => setError(t("err.server")));

  useEffect(() => {
    loadSession();
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError(t("err.server")));
  }, []);

  if (session?.authEnabled && !session.user) return <LoginPage onLogin={() => window.location.reload()} />;
  if (route.page === "stage") return <StagePage params={route.params} />;
  const role = session?.user?.role ?? "owner";

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Claudestra</strong>
        <nav className="nav">
          {NAV.filter((page) => page !== "users" || role === "owner").map((page) => (
            <a key={page} href={`#/${page}`} className={route.page === page ? "active" : ""}>
              {t(`nav.${page}`)}
            </a>
          ))}
        </nav>
        {health && (
          <span className={`badge ${health.canStartRuns ? "" : "badge-warn"}`} title={health.warning}>
            {health.authMode} · {t("top.agents", { n: health.agents.length })}
          </span>
        )}
        {session?.authEnabled && session.user && (
          <span className="badge" title={`role: ${role}`}>
            {session.user.name} · {role}{" "}
            <button className="linkish small" onClick={() => api("/api/logout", { body: {} }).then(() => window.location.reload())}>
              {t("top.logout")}
            </button>
          </span>
        )}
        <a className="ghost stage-link" href="#/stage?run=live" target="_blank" rel="noreferrer" title={t("top.stageWindowTitle")}>
          {t("top.stageWindow")}
        </a>
        <select className="lang-switch" value={lang()} onChange={(e) => setLang(e.target.value as "en" | "az")} title={t("top.language")} aria-label={t("top.language")}>
          <option value="az">AZ</option>
          <option value="en">EN</option>
        </select>
      </header>
      {(health?.warning || error) && <div className="banner">{error ?? health?.warning}</div>}
      <div className="page">
        {route.page === "agents" ? (
          <AgentsPage />
        ) : route.page === "skills" ? (
          <SkillsPage />
        ) : route.page === "apps" ? (
          <AppsPage />
        ) : route.page === "workflows" ? (
          <WorkflowsPage />
        ) : route.page === "costs" ? (
          <CostsPage />
        ) : route.page === "memory" ? (
          <MemoryPage />
        ) : route.page === "evals" ? (
          <EvalsPage />
        ) : route.page === "users" ? (
          <UsersPage authEnabled={Boolean(session?.authEnabled)} />
        ) : (
          <RunsPage health={health} initialRun={route.params.get("run")} />
        )}
      </div>
    </div>
  );
}
