import { useEffect, useState } from "react";
import type { RunSummary } from "@claudestra/protocol";
import { useRunEvents } from "./useRunEvents.ts";
import { Stage } from "./stage/Stage.tsx";

// Chromeless stage for a second monitor or an OBS browser source (docs/13):
//   #/stage?run=live            follow the newest run automatically (default)
//   #/stage?run=<id>            a specific run
//   &transparent=1  no background (OBS)   &hud=0  hide the text overlay   &fps=20  frame cap   &theme=light|dark
export function StagePage({ params }: { params: URLSearchParams }) {
  const wanted = params.get("run") ?? "live";
  const [runId, setRunId] = useState<string | null>(wanted === "live" ? null : wanted);
  const { run } = useRunEvents(runId);

  useEffect(() => {
    if (wanted !== "live") return setRunId(wanted);
    const pick = async () => {
      const res = await fetch("/api/runs").catch(() => null);
      if (!res?.ok) return;
      const runs = ((await res.json()) as RunSummary[]).filter((r) => r.source === "claudestra");
      const next = runs.find((r) => r.status === "running") ?? runs[0];
      if (next) setRunId((cur) => (cur === next.id ? cur : next.id));
    };
    pick();
    const timer = setInterval(pick, 3000);
    return () => clearInterval(timer);
  }, [wanted]);

  const transparent = params.get("transparent") === "1";
  useEffect(() => {
    document.body.classList.toggle("transparent-body", transparent);
    return () => document.body.classList.remove("transparent-body");
  }, [transparent]);

  const theme = params.get("theme");
  return (
    <div className="stage-page">
      {runId ? (
        <Stage key={runId} run={run} transparent={transparent} hud={params.get("hud") !== "0"} fps={Number(params.get("fps")) || 30} theme={theme === "light" || theme === "dark" ? theme : undefined} />
      ) : (
        <div className="empty">
          <h1>Claudestra stage</h1>
          <p className="muted">Waiting for a run… start one in the main window.</p>
        </div>
      )}
    </div>
  );
}
