import { useEffect, useRef, useState } from "react";
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
import { HqPage } from "./pages/HqPage.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { OfficePage } from "./pages/OfficePage.tsx";
import { MissionsPage } from "./pages/MissionsPage.tsx";
import { api } from "./api.ts";
import { lang, setLang, t, type Key } from "./i18n.ts";
import { notifyOn, notifySupported, toggleNotify, useNotifier } from "./notify.ts";

// The pages people use every day are always visible; setup and admin pages sit under "More".
const NAV = ["hq", "office", "chat", "missions", "runs", "projects"] as const;
const MORE = ["workflows", "agents", "skills", "apps", "memory", "evals", "costs", "users"] as const;

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

  const [waiting, setWaiting] = useState(0);
  const [bell, setBell] = useState(notifyOn);
  const moreRef = useRef<HTMLDetailsElement | null>(null);
  useNotifier(Boolean(session) && !(session?.authEnabled && !session.user) && route.page !== "stage", setWaiting);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (moreRef.current?.open && !moreRef.current.contains(e.target as Node)) moreRef.current.removeAttribute("open");
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  if (session?.authEnabled && !session.user) return <LoginPage onLogin={() => window.location.reload()} />;
  if (route.page === "stage") return <StagePage params={route.params} />;
  const role = session?.user?.role ?? "owner";

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Claudestra</strong>
        <nav className="nav">
          {NAV.map((page) => (
            <a key={page} href={`#/${page}`} className={route.page === page ? "active" : ""}>
              {t(`nav.${page}`)}
              {page === "hq" && waiting > 0 && <span className="nav-badge">{waiting}</span>}
            </a>
          ))}
          <details className="nav-more" ref={moreRef}>
            <summary className={(MORE as readonly string[]).includes(route.page) ? "active" : ""}>
              {(MORE as readonly string[]).includes(route.page) ? t(`nav.${route.page}` as Key) : t("nav.more")} ▾
            </summary>
            <div className="nav-menu">
              {MORE.filter((page) => page !== "users" || role === "owner").map((page) => (
                <a key={page} href={`#/${page}`} className={route.page === page ? "active" : ""} onClick={() => moreRef.current?.removeAttribute("open")}>
                  {t(`nav.${page}`)}
                </a>
              ))}
            </div>
          </details>
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
        {notifySupported() && (
          <button className={`ghost bell ${bell ? "on" : ""}`} onClick={() => void toggleNotify().then(setBell)} title={bell ? t("notify.on") : t("notify.off")} aria-pressed={bell} aria-label={bell ? t("notify.on") : t("notify.off")}>
            {bell ? "🔔" : "🔕"}
          </button>
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
        {route.page === "hq" ? (
          <HqPage session={session} />
        ) : route.page === "office" ? (
          <OfficePage health={health} session={session} />
        ) : route.page === "missions" ? (
          <MissionsPage key={route.params.get("id") ?? ""} health={health} session={session} initial={route.params.get("id")} />
        ) : route.page === "chat" ? (
          <ChatPage key={route.params.get("agent") ?? ""} health={health} session={session} initialAgent={route.params.get("agent")} />
        ) : route.page === "projects" ? (
          <ProjectsPage key={route.params.get("id") ?? ""} initial={route.params.get("id")} />
        ) : route.page === "agents" ? (
          <AgentsPage session={session} />
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
          <RunsPage health={health} session={session} initialRun={route.params.get("run")} initialProject={route.params.get("project")} initialAgent={route.params.get("agent")} />
        )}
      </div>
    </div>
  );
}
