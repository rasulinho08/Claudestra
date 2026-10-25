// SQLite-backed run store (docs/08). `events` is the source of truth; `runs` and `steps` are
// projections for fast lists. Live subscribers are kept in memory.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventData, type ClaudestraEvent, type RunStatus, type RunSummary, type StepStatus } from "@claudestra/protocol";

type Listener = (event: ClaudestraEvent) => void;

const RUN_TERMINAL: Partial<Record<ClaudestraEvent["type"], RunStatus>> = {
  "run.completed": "completed",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
};

const STEP_STATUS: Partial<Record<ClaudestraEvent["type"], StepStatus>> = {
  "step.ready": "ready",
  "step.started": "running",
  "step.succeeded": "succeeded",
  "step.failed": "failed",
  "step.skipped": "skipped",
  "step.cancelled": "cancelled",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  cost_usd REAL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  agent_id TEXT,
  task TEXT,
  status TEXT NOT NULL,
  cost_usd REAL,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (run_id, step_id)
);
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  step_id TEXT,
  agent_id TEXT,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

export class RunStore {
  private db: DatabaseSync;
  private listeners = new Map<string, Set<Listener>>();
  private nextSeq = new Map<string, number>();

  constructor(dbPath = ":memory:") {
    if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  create(summary: Pick<RunSummary, "id" | "prompt" | "source">): RunSummary {
    const full: RunSummary = { ...summary, status: "running", costUsd: null, startedAt: new Date().toISOString() };
    this.db
      .prepare("INSERT OR REPLACE INTO runs (id, prompt, source, status, cost_usd, started_at) VALUES (?, ?, ?, ?, NULL, ?)")
      .run(full.id, full.prompt, full.source, full.status, full.startedAt);
    return full;
  }

  has(runId: string): boolean {
    return this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId) !== undefined;
  }

  append(runId: string, input: EventData, extra: { stepId?: string; agentId?: string } = {}): ClaudestraEvent {
    if (!this.has(runId)) throw new Error(`unknown run ${runId}`);
    const data = EventData.parse(input);
    const seq = this.seqFor(runId);
    const event = { ...data, ...extra, seq, runId, ts: new Date().toISOString() } as ClaudestraEvent;

    this.db
      .prepare("INSERT INTO events (run_id, seq, ts, step_id, agent_id, type, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(runId, seq, event.ts, extra.stepId ?? null, extra.agentId ?? null, event.type, JSON.stringify(event.data));
    this.project(event);

    for (const listener of this.listeners.get(runId) ?? []) listener(event);
    return event;
  }

  events(runId: string, afterSeq = 0): ClaudestraEvent[] {
    const rows = this.db
      .prepare("SELECT seq, ts, step_id, agent_id, type, data FROM events WHERE run_id = ? AND seq > ? ORDER BY seq")
      .all(runId, afterSeq) as { seq: number; ts: string; step_id: string | null; agent_id: string | null; type: string; data: string }[];
    return rows.map((r) => {
      const event = { type: r.type, data: JSON.parse(r.data), seq: r.seq, runId, ts: r.ts } as ClaudestraEvent;
      if (r.step_id) event.stepId = r.step_id;
      if (r.agent_id) event.agentId = r.agent_id;
      return event;
    });
  }

  status(runId: string): RunStatus | undefined {
    const row = this.db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: RunStatus } | undefined;
    return row?.status;
  }

  subscribe(runId: string, listener: Listener): () => void {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  list(limit = 100): RunSummary[] {
    const rows = this.db
      .prepare("SELECT id, prompt, source, status, cost_usd, started_at FROM runs ORDER BY started_at DESC LIMIT ?")
      .all(limit) as { id: string; prompt: string; source: RunSummary["source"]; status: RunStatus; cost_usd: number | null; started_at: string }[];
    return rows.map((r) => ({ id: r.id, prompt: r.prompt, source: r.source, status: r.status, costUsd: r.cost_usd, startedAt: r.started_at }));
  }

  recordArtifact(a: { id: string; runId: string; stepId: string; title: string; path: string; bytes: number }) {
    this.db
      .prepare("INSERT OR REPLACE INTO artifacts (id, run_id, step_id, title, path, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(a.id, a.runId, a.stepId, a.title, a.path, a.bytes, new Date().toISOString());
  }

  // Runs left "running" by a previous server process can never finish; close them.
  failInterrupted(): number {
    const rows = this.db.prepare("SELECT id FROM runs WHERE status = 'running' AND source = 'claudestra'").all() as { id: string }[];
    for (const { id } of rows) this.append(id, { type: "run.failed", data: { error: "Server restarted while the run was in progress" } });
    return rows.length;
  }

  close() {
    this.db.close();
  }

  private seqFor(runId: string): number {
    let next = this.nextSeq.get(runId);
    if (next === undefined) {
      const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS max FROM events WHERE run_id = ?").get(runId) as { max: number };
      next = row.max + 1;
    }
    this.nextSeq.set(runId, next + 1);
    return next;
  }

  private project(event: ClaudestraEvent) {
    const runStatus = RUN_TERMINAL[event.type];
    if (runStatus) {
      this.db.prepare("UPDATE runs SET status = ?, ended_at = ? WHERE id = ?").run(runStatus, event.ts, event.runId);
    }
    if (event.type === "usage.updated" && event.data.runCostUsd !== null) {
      this.db.prepare("UPDATE runs SET cost_usd = ? WHERE id = ?").run(event.data.runCostUsd, event.runId);
    }
    if (event.type === "run.completed" && event.data.totalCostUsd !== null) {
      this.db.prepare("UPDATE runs SET cost_usd = ? WHERE id = ?").run(event.data.totalCostUsd, event.runId);
    }

    const stepStatus = STEP_STATUS[event.type];
    if (event.stepId && stepStatus) {
      const task = event.type === "step.ready" || event.type === "step.started" ? event.data.task : null;
      const cost = event.type === "step.succeeded" ? event.data.costUsd : null;
      const terminal = ["succeeded", "failed", "skipped", "cancelled"].includes(stepStatus);
      this.db
        .prepare(
          `INSERT INTO steps (run_id, step_id, agent_id, task, status, cost_usd, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (run_id, step_id) DO UPDATE SET
             status = excluded.status,
             task = COALESCE(excluded.task, steps.task),
             cost_usd = COALESCE(excluded.cost_usd, steps.cost_usd),
             started_at = COALESCE(steps.started_at, excluded.started_at),
             ended_at = COALESCE(excluded.ended_at, steps.ended_at)`,
        )
        .run(event.runId, event.stepId, event.agentId ?? null, task, stepStatus, cost, stepStatus === "running" ? event.ts : null, terminal ? event.ts : null);
    }
  }
}
