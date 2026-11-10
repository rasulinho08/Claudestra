// Missions (docs/17): one prompt that the team keeps working on in the background for days. A mission is a chain of
// ordinary runs ("ticks"): each tick starts in a copy of the previous tick's files, reads mission/board.md and
// mission/journal.md, does the next tasks, updates both, and stops. The heartbeat starts the next tick after the
// interval. Limits (5-hour usage windows, daily budget) or a restart only delay the next tick; nothing is lost,
// because the state lives in the files and in this table.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AnswerLanguage, ApprovalMode, Profile } from "@claudestra/protocol";
import type { RunStore } from "./store.ts";
import type { RunRequest } from "./runs.ts";

export const MissionInput = z.object({
  goal: z.string().trim().min(3).max(20_000),
  title: z.string().trim().max(80).default(""),
  // Whole team (CEO plans each tick) or one agent.
  agentId: z.string().max(64).nullable().default(null),
  intervalMinutes: z.number().int().min(5).max(7 * 24 * 60).default(120),
  days: z.number().min(0.04).max(60).default(7),
  // Total spend across all ticks; null = only the per-run and daily budgets apply.
  budgetUsd: z.number().positive().max(10_000).nullable().default(null),
  profile: Profile.optional(),
  approvalMode: ApprovalMode.default("smart"),
  language: AnswerLanguage.default("auto"),
});
export type MissionInput = z.infer<typeof MissionInput>;

export type MissionStatus = "active" | "paused" | "done" | "stopped" | "failed";

export type Mission = {
  id: string;
  title: string;
  goal: string;
  agentId: string | null;
  status: MissionStatus;
  intervalMinutes: number;
  endsAt: string;
  budgetUsd: number | null;
  profile: string | null;
  approvalMode: string;
  language: string;
  ticks: number;
  spentUsd: number;
  // The run in flight, if any, and the last finished run whose files the next tick continues from.
  currentRunId: string | null;
  lastRunId: string | null;
  nextTickAt: string | null;
  lastError: string | null;
  failures: number;
  note: string;
  createdBy: string | null;
  createdAt: string;
};

type Row = {
  id: string; title: string; goal: string; agent_id: string | null; status: MissionStatus; interval_minutes: number; ends_at: string; budget_usd: number | null;
  profile: string | null; approval_mode: string; language: string; ticks: number; spent_usd: number; current_run_id: string | null; last_run_id: string | null;
  next_tick_at: string | null; last_error: string | null; failures: number; note: string; created_by: string | null; created_at: string;
};

export const MAX_FAILURES = 3;
export const DONE_MARK = /^\s*MISSION STATUS:\s*DONE\b/im;

export class Missions {
  constructor(private store: RunStore) {
    this.store.database.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT NOT NULL, agent_id TEXT, status TEXT NOT NULL, interval_minutes INTEGER NOT NULL,
        ends_at TEXT NOT NULL, budget_usd REAL, profile TEXT, approval_mode TEXT NOT NULL, language TEXT NOT NULL, ticks INTEGER NOT NULL DEFAULT 0,
        spent_usd REAL NOT NULL DEFAULT 0, current_run_id TEXT, last_run_id TEXT, next_tick_at TEXT, last_error TEXT, failures INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mission_runs (mission_id TEXT NOT NULL, run_id TEXT NOT NULL, tick INTEGER NOT NULL, started_at TEXT NOT NULL, PRIMARY KEY (mission_id, run_id));`);
  }

  private toMission(r: Row): Mission {
    return {
      id: r.id, title: r.title, goal: r.goal, agentId: r.agent_id, status: r.status, intervalMinutes: r.interval_minutes, endsAt: r.ends_at, budgetUsd: r.budget_usd,
      profile: r.profile, approvalMode: r.approval_mode, language: r.language, ticks: r.ticks, spentUsd: r.spent_usd, currentRunId: r.current_run_id,
      lastRunId: r.last_run_id, nextTickAt: r.next_tick_at, lastError: r.last_error, failures: r.failures, note: r.note, createdBy: r.created_by, createdAt: r.created_at,
    };
  }

  list(user: string | null = null, all = true): Mission[] {
    const rows = this.store.database.prepare("SELECT * FROM missions ORDER BY created_at DESC").all() as Row[];
    return rows.map((r) => this.toMission(r)).filter((m) => all || m.createdBy === user);
  }

  get(id: string): Mission | undefined {
    const r = this.store.database.prepare("SELECT * FROM missions WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toMission(r) : undefined;
  }

  create(input: MissionInput, createdBy: string | null, now = new Date()): Mission {
    const id = randomUUID();
    const title = input.title || input.goal.split(/\r?\n/)[0]!.slice(0, 70);
    this.store.database
      .prepare("INSERT INTO missions (id, title, goal, agent_id, status, interval_minutes, ends_at, budget_usd, profile, approval_mode, language, next_tick_at, created_by, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, title, input.goal, input.agentId, input.intervalMinutes, new Date(now.getTime() + input.days * 86_400_000).toISOString(), input.budgetUsd, input.profile ?? null, input.approvalMode, input.language, now.toISOString(), createdBy, now.toISOString());
    return this.get(id)!;
  }

  remove(id: string): boolean {
    this.store.database.prepare("DELETE FROM mission_runs WHERE mission_id = ?").run(id);
    return Number(this.store.database.prepare("DELETE FROM missions WHERE id = ?").run(id).changes) > 0;
  }

  runs(id: string): { runId: string; tick: number; startedAt: string }[] {
    return (this.store.database.prepare("SELECT run_id, tick, started_at FROM mission_runs WHERE mission_id = ? ORDER BY tick DESC").all(id) as { run_id: string; tick: number; started_at: string }[]).map((r) => ({
      runId: r.run_id, tick: r.tick, startedAt: r.started_at,
    }));
  }

  set(id: string, fields: Partial<{ status: MissionStatus; ticks: number; spent_usd: number; current_run_id: string | null; last_run_id: string | null; next_tick_at: string | null; last_error: string | null; failures: number; note: string }>) {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (keys.length === 0) return;
    this.store.database.prepare(`UPDATE missions SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k] as string | number | null), id);
  }

  addRun(id: string, runId: string, tick: number, now: Date) {
    this.store.database.prepare("INSERT OR IGNORE INTO mission_runs (mission_id, run_id, tick, started_at) VALUES (?, ?, ?, ?)").run(id, runId, tick, now.toISOString());
  }
}

// What every tick is told, on top of the goal. Kept short: it is sent with every tick.
export function tickBrief(m: Mission, tick: number, now: Date): string {
  const left = Math.max(0, new Date(m.endsAt).getTime() - now.getTime());
  const daysLeft = (left / 86_400_000).toFixed(1);
  return [
    `# Long-running mission (work session ${tick})`,
    `This is one work session of a mission that runs in the background for days, a session every ${m.intervalMinutes} minutes. About ${daysLeft} day(s) remain (ends ${m.endsAt.slice(0, 16).replace("T", " ")} UTC). The workspace already holds every file from earlier sessions.`,
    "",
    "## Mission goal",
    m.goal,
    "",
    "## How to work in this session",
    tick === 1
      ? "1. This is the first session: create mission/board.md (sections: Todo, Doing, Done, Blocked: needs owner), breaking the goal into concrete tasks spread over the available days, and mission/journal.md."
      : "1. Read mission/board.md and mission/journal.md first. They are the memory of this mission: never start over and never redo a task listed under Done.",
    "2. Do the next 1–3 most valuable tasks from the board. Produce real results in files, not plans about plans.",
    "3. Update mission/board.md (move tasks, add newly discovered ones) and append an entry to mission/journal.md: date, what was done, results and file paths, what comes next.",
    "4. If a task needs the owner (a decision, access, a key, an approval), put it under \"Blocked: needs owner\" with the exact question and continue with other tasks.",
    "5. When the whole goal is achieved, make the very first line of mission/board.md exactly: MISSION STATUS: DONE",
    m.note ? `\n## Note from the owner (added while the mission runs)\n${m.note}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export type MissionDeps = {
  missions: Missions;
  store: RunStore;
  workspacesDir: string;
  start: (req: RunRequest) => { runId: string };
};

// Reads a mission file from the latest tick's workspace (symlinks may not lead outside it).
export function missionFile(workspacesDir: string, runId: string | null, name: "board.md" | "journal.md"): string {
  if (!runId || !/^[A-Za-z0-9-]{1,128}$/.test(runId)) return "";
  const root = path.join(workspacesDir, runId);
  const file = path.join(root, "mission", name);
  try {
    if (!existsSync(file)) return "";
    const real = realpathSync(file);
    const rel = path.relative(realpathSync(root), real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return "";
    return readFileSync(real, "utf8").slice(0, 200_000);
  } catch {
    return "";
  }
}

export class MissionRunner {
  private timer: NodeJS.Timeout | null = null;

  constructor(private deps: MissionDeps) {}

  start(intervalMs = 20_000) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // One heartbeat: close finished ticks, then start the ticks that are due. Returns the run ids it started.
  tick(now = new Date()): string[] {
    const started: string[] = [];
    for (const m of this.deps.missions.list()) {
      try {
        const fresh = m.currentRunId ? this.settle(m, now) : m;
        if (fresh && fresh.status === "active" && !fresh.currentRunId && fresh.nextTickAt && new Date(fresh.nextTickAt) <= now) {
          const runId = this.launch(fresh, now);
          if (runId) started.push(runId);
        }
      } catch (err) {
        this.deps.missions.set(m.id, { last_error: err instanceof Error ? err.message : String(err) });
      }
    }
    return started;
  }

  // The tick in flight has ended (or is still running): record the result and decide what comes next.
  private settle(m: Mission, now: Date): Mission | undefined {
    const { missions, store } = this.deps;
    const status = store.status(m.currentRunId!);
    if (status === "running") return m;
    const cost = store.summary(m.currentRunId!)?.costUsd ?? 0;
    const ok = status === "completed";
    const spent = m.spentUsd + cost;
    const failures = ok ? 0 : m.failures + 1;
    const fields: Parameters<Missions["set"]>[1] = {
      current_run_id: null,
      spent_usd: spent,
      failures,
      // A failed or cancelled tick leaves half-done files: the next tick continues from the last good one.
      last_run_id: ok ? m.currentRunId : m.lastRunId,
      last_error: ok ? null : `work session ${m.ticks} ${status ?? "was lost"}`,
      next_tick_at: new Date(now.getTime() + m.intervalMinutes * 60_000).toISOString(),
    };
    if (m.status === "active") {
      if (ok && DONE_MARK.test(missionFile(this.deps.workspacesDir, m.currentRunId, "board.md").slice(0, 400))) fields.status = "done";
      else if (m.budgetUsd !== null && spent >= m.budgetUsd) Object.assign(fields, { status: "stopped", last_error: `mission budget of $${m.budgetUsd} reached` });
      else if (new Date(m.endsAt) <= now) Object.assign(fields, { status: "stopped", last_error: null });
      else if (failures >= MAX_FAILURES) Object.assign(fields, { status: "failed", last_error: `${MAX_FAILURES} work sessions failed in a row; fix the cause and resume` });
    }
    if (fields.status) fields.next_tick_at = null;
    missions.set(m.id, fields);
    return missions.get(m.id);
  }

  private launch(m: Mission, now: Date): string | null {
    const { missions } = this.deps;
    if (new Date(m.endsAt) <= now) {
      missions.set(m.id, { status: "stopped", next_tick_at: null });
      return null;
    }
    const tick = m.ticks + 1;
    try {
      const { runId } = this.deps.start({
        prompt: `[${m.title} · ${tick}] ${m.goal}`.slice(0, 20_000),
        history: tickBrief(m, tick, now),
        seedFrom: m.lastRunId ?? undefined,
        agentId: m.agentId ?? undefined,
        profile: (m.profile as RunRequest["profile"]) ?? undefined,
        approvalMode: m.approvalMode as RunRequest["approvalMode"],
        language: m.language as RunRequest["language"],
        createdBy: m.createdBy ?? undefined,
        origin: `mission:${m.id}`,
      });
      missions.addRun(m.id, runId, tick, now);
      missions.set(m.id, { ticks: tick, current_run_id: runId, last_error: null });
      return runId;
    } catch (err) {
      // Not connected, daily budget reached, usage limit: not the mission's fault. Try again after a short wait.
      const wait = Math.min(m.intervalMinutes, 30) * 60_000;
      missions.set(m.id, { last_error: err instanceof Error ? err.message : String(err), next_tick_at: new Date(now.getTime() + wait).toISOString() });
      return null;
    }
  }
}
