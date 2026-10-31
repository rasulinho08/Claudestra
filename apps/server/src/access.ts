// Login and roles (docs/12 "Deploy"). Off by default for local use; turns on when AUTH_TOKEN is set or a user exists.
//   owner    – everything (agents, skills, workflows, triggers, memory, users)
//   operator – start / control runs, answer approvals, run workflows and evals
//   viewer   – read only
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Role, SessionInfo } from "@claudestra/protocol";
import type { RunStore } from "./store.ts";

export type User = { id: string; name: string; role: Role; createdAt: string; lastSeen: string | null };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class Access {
  constructor(private store: RunStore, private ownerToken: string | null = null) {
    this.store.database.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, last_seen TEXT)`);
  }

  get enabled(): boolean {
    return Boolean(this.ownerToken) || this.users().length > 0;
  }

  users(): User[] {
    return (this.store.database.prepare("SELECT id, name, role, created_at, last_seen FROM users ORDER BY created_at").all() as { id: string; name: string; role: Role; created_at: string; last_seen: string | null }[]).map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      createdAt: u.created_at,
      lastSeen: u.last_seen,
    }));
  }

  // Returns the new user's token once; only its hash is stored.
  addUser(name: string, role: Role): { user: User; token: string } {
    if (!/^[\w.@-]{1,64}$/.test(name)) throw new Error("names are 1–64 letters, digits, . _ - @");
    const token = `cls_${randomBytes(24).toString("base64url")}`;
    const id = randomUUID();
    this.store.database.prepare("INSERT INTO users (id, name, role, token_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, role, hash(token), new Date().toISOString());
    return { user: this.users().find((u) => u.id === id)!, token };
  }

  removeUser(nameOrId: string): boolean {
    return Number(this.store.database.prepare("DELETE FROM users WHERE id = ? OR name = ?").run(nameOrId, nameOrId).changes) > 0;
  }

  identify(token: string | undefined | null): SessionInfo["user"] {
    if (!token) return null;
    if (this.ownerToken && safeEqual(token, this.ownerToken)) return { name: "owner", role: "owner" };
    const row = this.store.database.prepare("SELECT id, name, role FROM users WHERE token_hash = ?").get(hash(token)) as { id: string; name: string; role: Role } | undefined;
    if (!row) return null;
    this.store.database.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return { name: row.name, role: row.role };
  }
}

const OPERATOR_WRITES = [/^\/api\/runs(\/|$)/, /^\/api\/evals\/[^/]+\/run$/];

// Minimum role for a request (GET is read access).
export function requiredRole(method: string, path: string): Role {
  if (method === "GET" || method === "HEAD") return "viewer";
  // Uses the owner's GitHub token or this computer's file manager.
  if (/^\/api\/runs\/[^/]+\/(github|open-folder)$/.test(path)) return "owner";
  if (OPERATOR_WRITES.some((re) => re.test(path))) return "operator";
  return "owner";
}

const RANK: Record<Role, number> = { viewer: 0, operator: 1, owner: 2 };
export const allows = (have: Role, need: Role) => RANK[have] >= RANK[need];

export function tokenFrom(header: string | undefined, cookie: string | undefined, query: string | undefined): string | undefined {
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const fromCookie = cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("claudestra_token="))
    ?.slice("claudestra_token=".length);
  return fromCookie ? decodeURIComponent(fromCookie) : query || undefined;
}
