// Chat with an agent (docs/07 "Chat"): a conversation is a list of runs. Each new message is a run (direct to the
// conversation's agent, or the whole team when no agent is set) that gets the earlier turns as context and continues
// in a copy of the previous turn's files, so "now make the header blue" works on the dashboard it made before.
import { randomUUID } from "node:crypto";
import type { RunStore } from "./store.ts";

export type Conversation = { id: string; agentId: string | null; title: string; createdBy: string | null; createdAt: string; updatedAt: string };
export type Turn = { runId: string; prompt: string; status: string; answer: string | null; error: string | null; startedAt: string; costUsd: number | null };

const HISTORY_TURNS = 6;
const ANSWER_CHARS = 1500;

export class Chats {
  constructor(private store: RunStore) {
    store.database.exec(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, agent_id TEXT, title TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversation_runs (run_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn INTEGER NOT NULL);`);
  }

  private row = (r: { id: string; agent_id: string | null; title: string; created_by: string | null; created_at: string; updated_at: string }): Conversation => ({
    id: r.id,
    agentId: r.agent_id,
    title: r.title,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  // A person sees their own conversations; the owner (or local use, user null) sees all.
  list(user: string | null, all: boolean): Conversation[] {
    const rows = (all
      ? this.store.database.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200").all()
      : this.store.database.prepare("SELECT * FROM conversations WHERE created_by = ? ORDER BY updated_at DESC LIMIT 200").all(user)) as Parameters<typeof this.row>[0][];
    return rows.map(this.row);
  }

  get(id: string): Conversation | undefined {
    const r = this.store.database.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Parameters<typeof this.row>[0] | undefined;
    return r && this.row(r);
  }

  create(agentId: string | null, createdBy: string | null, title = ""): Conversation {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.store.database.prepare("INSERT INTO conversations (id, agent_id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, agentId, title.slice(0, 80), createdBy, now, now);
    return this.get(id)!;
  }

  remove(id: string): boolean {
    this.store.database.prepare("DELETE FROM conversation_runs WHERE conversation_id = ?").run(id);
    return Number(this.store.database.prepare("DELETE FROM conversations WHERE id = ?").run(id).changes) > 0;
  }

  turns(id: string): Turn[] {
    const rows = this.store.database
      .prepare("SELECT c.run_id, r.prompt, r.status, r.started_at, r.cost_usd FROM conversation_runs c JOIN runs r ON r.id = c.run_id WHERE c.conversation_id = ? ORDER BY c.turn")
      .all(id) as { run_id: string; prompt: string; status: string; started_at: string; cost_usd: number | null }[];
    return rows.map((r) => {
      const end = [...this.store.events(r.run_id)].reverse().find((e) => e.type === "run.completed" || e.type === "run.failed");
      return {
        runId: r.run_id,
        prompt: r.prompt,
        status: r.status,
        answer: end?.type === "run.completed" ? end.data.answer : null,
        error: end?.type === "run.failed" ? end.data.error : null,
        startedAt: r.started_at,
        costUsd: r.cost_usd,
      };
    });
  }

  // Context for the next message: the last turns, answers shortened.
  history(id: string, agentName: string): string {
    const turns = this.turns(id).filter((t) => t.status !== "running").slice(-HISTORY_TURNS);
    if (turns.length === 0) return "";
    const lines = turns.map((t) => `User: ${t.prompt}\n${agentName}: ${(t.answer ?? (t.error ? `(failed: ${t.error})` : "(no answer)")).slice(0, ANSWER_CHARS)}`);
    return `This message continues a conversation. The workspace already holds the files from the previous turn; change them instead of starting over when the user refers to earlier work.\n\nConversation so far (oldest first):\n${lines.join("\n\n")}`;
  }

  lastRun(id: string): string | undefined {
    const r = this.store.database.prepare("SELECT run_id FROM conversation_runs WHERE conversation_id = ? ORDER BY turn DESC LIMIT 1").get(id) as { run_id: string } | undefined;
    return r?.run_id;
  }

  addTurn(id: string, runId: string, prompt: string) {
    const n = (this.store.database.prepare("SELECT COUNT(*) AS n FROM conversation_runs WHERE conversation_id = ?").get(id) as { n: number }).n;
    this.store.database.prepare("INSERT INTO conversation_runs (run_id, conversation_id, turn) VALUES (?, ?, ?)").run(runId, id, n + 1);
    const c = this.get(id)!;
    this.store.database.prepare("UPDATE conversations SET updated_at = ?, title = ? WHERE id = ?").run(new Date().toISOString(), c.title || prompt.replace(/\s+/g, " ").slice(0, 80), id);
  }
}
