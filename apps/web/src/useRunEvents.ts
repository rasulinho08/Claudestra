import { useEffect, useReducer } from "react";
import type { ClaudestraEvent } from "@claudestra/protocol";
import { emptyRun, reduceRun, type RunView } from "./run-state.ts";

type State = { run: RunView; events: ClaudestraEvent[] };
type Action = { type: "reset" } | { type: "event"; event: ClaudestraEvent };

const initial = (): State => ({ run: emptyRun(), events: [] });

function reducer(state: State, action: Action): State {
  if (action.type === "reset") return initial();
  if (action.event.seq <= state.run.lastSeq) return state;
  return { run: reduceRun(state.run, action.event), events: [...state.events, action.event] };
}

// Subscribes to a run's SSE stream. EventSource reconnects on its own and sends Last-Event-ID,
// so a dropped connection resumes without duplicates (the reducer also ignores old seqs).
export function useRunEvents(runId: string | null): State {
  const [state, dispatch] = useReducer(reducer, undefined, initial);

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!runId) return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    let project = false;
    source.addEventListener("event", (msg) => {
      const event = JSON.parse((msg as MessageEvent<string>).data) as ClaudestraEvent;
      dispatch({ type: "event", event });
      if (event.type === "run.started" && event.data.project) project = true;
      // Claudestra runs end; observer sessions keep streaming until SessionEnd, and project runs stay open for the
      // project.applied events that apply/undo add after the end.
      if (!project && (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled")) source.close();
    });
    return () => source.close();
  }, [runId]);

  return state;
}
