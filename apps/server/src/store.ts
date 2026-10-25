// In-memory run + event store with live subscribers. Events are the source of truth (docs/08);
// SQLite persistence replaces this in Phase 1.
import type { ClaudestraEvent, EventData, RunStatus, RunSummary } from "@claudestra/protocol";

type Listener = (event: ClaudestraEvent) => void;

type RunRecord = {
  summary: RunSummary;
  events: ClaudestraEvent[];
  listeners: Set<Listener>;
};

const TERMINAL: Partial<Record<EventData["type"], RunStatus>> = {
  "run.completed": "completed",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
};

export class RunStore {
  private runs = new Map<string, RunRecord>();

  constructor(private maxRuns = 50) {}

  create(summary: Omit<RunSummary, "status" | "costUsd" | "startedAt">): RunSummary {
    const full: RunSummary = { ...summary, status: "running", costUsd: null, startedAt: new Date().toISOString() };
    this.runs.set(full.id, { summary: full, events: [], listeners: new Set() });
    this.evict();
    return full;
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  append(runId: string, data: EventData, extra: { stepId?: string; agentId?: string } = {}): ClaudestraEvent {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    const event = {
      ...data,
      ...extra,
      seq: run.events.length + 1,
      runId,
      ts: new Date().toISOString(),
    } as ClaudestraEvent;
    run.events.push(event);

    const terminal = TERMINAL[event.type];
    if (terminal) run.summary.status = terminal;
    if (event.type === "usage.updated" && event.data.costUsd !== null) run.summary.costUsd = event.data.costUsd;

    for (const listener of run.listeners) listener(event);
    return event;
  }

  events(runId: string): ClaudestraEvent[] {
    return this.runs.get(runId)?.events.slice() ?? [];
  }

  status(runId: string): RunStatus | undefined {
    return this.runs.get(runId)?.summary.status;
  }

  subscribe(runId: string, listener: Listener): () => void {
    const run = this.runs.get(runId);
    if (!run) return () => {};
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  list(): RunSummary[] {
    return [...this.runs.values()].map((r) => ({ ...r.summary })).reverse();
  }

  private evict() {
    while (this.runs.size > this.maxRuns) {
      const oldest = this.runs.keys().next().value;
      if (oldest === undefined) return;
      this.runs.delete(oldest);
    }
  }
}
