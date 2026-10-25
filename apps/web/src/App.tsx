import { useEffect, useState } from "react";
import type { HealthResponse } from "@claudestra/protocol";
import { useRoute } from "./router.ts";
import { RunsPage } from "./RunsPage.tsx";
import { StagePage } from "./StagePage.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { SkillsPage } from "./pages/SkillsPage.tsx";
import { AppsPage } from "./pages/AppsPage.tsx";
import { WorkflowsPage } from "./pages/WorkflowsPage.tsx";
import { CostsPage } from "./pages/CostsPage.tsx";

const NAV = [
  ["runs", "Runs"],
  ["workflows", "Workflows"],
  ["agents", "Agents"],
  ["skills", "Skills"],
  ["apps", "Apps"],
  ["costs", "Costs"],
] as const;

export function App() {
  const route = useRoute();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError("Server is not reachable on :8787. Start it with `npm run dev`."));
  }, []);

  if (route.page === "stage") return <StagePage params={route.params} />;

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Claudestra</strong>
        <nav className="nav">
          {NAV.map(([page, label]) => (
            <a key={page} href={`#/${page}`} className={route.page === page ? "active" : ""}>
              {label}
            </a>
          ))}
        </nav>
        {health && (
          <span className={`badge ${health.canStartRuns ? "" : "badge-warn"}`} title={health.warning}>
            {health.authMode} · {health.agents.length} agents
          </span>
        )}
        <a className="ghost stage-link" href="#/stage?run=live" target="_blank" rel="noreferrer" title="Open the robot stage for a second monitor or OBS (follows the newest run)">
          ▶ Stage window
        </a>
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
        ) : (
          <RunsPage health={health} initialRun={route.params.get("run")} />
        )}
      </div>
    </div>
  );
}
