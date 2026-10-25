// Cross-run memory (docs/04 "Context between runs"): owner notes that every run sees, plus short summaries of
// finished runs that the CEO gets when a new request looks related. No extra model calls: summaries are the
// first part of the final answer, recall is keyword overlap.
import { randomUUID } from "node:crypto";
import type { RunStore } from "./store.ts";

export type MemoryNote = { id: string; text: string; createdAt: string };
export type RememberedRun = { runId: string; prompt: string; summary: string; createdAt: string };

const STOP = new Set("the a an and or of to in on for with by is are was be it this that from as at into about then than your you our we i me my can could should would will please make write create build".split(" "));
const SUMMARY_CHARS = 600;
const NOTES_CHARS = 1500;

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

// Share of the request's keywords that also appear in the remembered run.
export function similarity(query: Set<string>, doc: Set<string>): number {
  if (query.size === 0) return 0;
  let hit = 0;
  for (const w of query) if (doc.has(w)) hit++;
  return hit / query.size;
}

export class Memory {
  constructor(private store: RunStore, private enabled = true) {
    this.store.database.exec(`
      CREATE TABLE IF NOT EXISTS memory_notes (id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_memory (run_id TEXT PRIMARY KEY, prompt TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  }

  get isEnabled() {
    return this.enabled;
  }

  notes(): MemoryNote[] {
    return (this.store.database.prepare("SELECT id, text, created_at FROM memory_notes ORDER BY created_at").all() as { id: string; text: string; created_at: string }[]).map((r) => ({ id: r.id, text: r.text, createdAt: r.created_at }));
  }

  addNote(text: string): MemoryNote {
    const note = { id: randomUUID(), text: text.trim().slice(0, 1000), createdAt: new Date().toISOString() };
    this.store.database.prepare("INSERT INTO memory_notes (id, text, created_at) VALUES (?, ?, ?)").run(note.id, note.text, note.createdAt);
    return note;
  }

  deleteNote(id: string): boolean {
    return Number(this.store.database.prepare("DELETE FROM memory_notes WHERE id = ?").run(id).changes) > 0;
  }

  remember(runId: string, prompt: string, answer: string) {
    if (!this.enabled || !answer.trim()) return;
    this.store.database
      .prepare("INSERT OR REPLACE INTO run_memory (run_id, prompt, summary, created_at) VALUES (?, ?, ?, ?)")
      .run(runId, prompt.slice(0, 2000), answer.trim().slice(0, SUMMARY_CHARS), new Date().toISOString());
  }

  forget(runId: string): boolean {
    return Number(this.store.database.prepare("DELETE FROM run_memory WHERE run_id = ?").run(runId).changes) > 0;
  }

  runs(limit = 200): RememberedRun[] {
    return (this.store.database.prepare("SELECT run_id, prompt, summary, created_at FROM run_memory ORDER BY created_at DESC LIMIT ?").all(limit) as { run_id: string; prompt: string; summary: string; created_at: string }[]).map((r) => ({
      runId: r.run_id,
      prompt: r.prompt,
      summary: r.summary,
      createdAt: r.created_at,
    }));
  }

  recall(prompt: string, k = 3, minScore = 0.25): RememberedRun[] {
    if (!this.enabled) return [];
    const q = keywords(prompt);
    return this.runs(500)
      .map((r) => ({ r, score: similarity(q, keywords(`${r.prompt} ${r.summary}`)) }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.r);
  }

  // Text blocks for prompts; empty strings when there is nothing to add.
  notesBlock(): string {
    if (!this.enabled) return "";
    const notes = this.notes();
    if (notes.length === 0) return "";
    let text = notes.map((n) => `- ${n.text}`).join("\n");
    if (text.length > NOTES_CHARS) text = `${text.slice(0, NOTES_CHARS)}…`;
    return `Company notes from the owner (always apply):\n${text}`;
  }

  recallBlock(runs: RememberedRun[]): string {
    if (runs.length === 0) return "";
    return `Related earlier work (summaries; reuse facts, do not redo finished work without reason):\n${runs
      .map((r) => `- Request: ${r.prompt.slice(0, 200)}\n  Result: ${r.summary.replace(/\s+/g, " ").slice(0, 400)}`)
      .join("\n")}`;
  }
}
