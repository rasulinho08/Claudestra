import { useEffect, useState, type FormEvent } from "react";
import type { Role } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";

type User = { id: string; name: string; role: Role; createdAt: string; lastSeen: string | null };

// Users and roles (owner only). Creating the first user turns login on for everyone.
export function UsersPage({ authEnabled }: { authEnabled: boolean }) {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<User[]>("/api/users").then(setUsers).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ token: string }>("/api/users", { body: { name, role } });
      setToken(res.token);
      // The first user turns login on: log this browser in with the new owner token so nobody is locked out.
      if (!authEnabled) {
        await api("/api/login", { body: { token: res.token } });
        window.location.reload();
      }
      setName("");
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="page-scroll">
      <div className="page-narrow">
        <h2>Users</h2>
        <p className="muted small">
          Login is <strong>{authEnabled ? "on" : "off"}</strong>. It turns on when <code>AUTH_TOKEN</code> is set in .env or once a user exists. Roles: <strong>owner</strong>{" "}
          (everything), <strong>operator</strong> (start runs, approve, run workflows and evals), <strong>viewer</strong> (read only). Needed before you open Claudestra to other people
          or deploy it (doc 12).
        </p>
        {!authEnabled && <div className="banner">Before adding the first user, set AUTH_TOKEN in .env (or keep the token shown below) — otherwise you lock yourself out of this page.</div>}
        {error && <div className="error small">{error}</div>}
        <form className="row-gap" onSubmit={add}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="owner">owner</option>
            <option value="operator">operator</option>
            <option value="viewer">viewer</option>
          </select>
          <button type="submit" className="btn-primary" disabled={!name.trim()}>
            Add user
          </button>
        </form>
        {token && (
          <div className="card">
            <strong>Token (shown once):</strong>
            <pre className="code">{token}</pre>
            <span className="small muted">Give it to the user; they paste it on the login screen.</span>
          </div>
        )}
        {users.map((u) => (
          <div key={u.id} className="card row-between">
            <span>
              <strong>{u.name}</strong> <span className="chip">{u.role}</span> <span className="muted small">last seen {u.lastSeen ? new Date(u.lastSeen).toLocaleString() : "never"}</span>
            </span>
            <button className="ghost" onClick={() => api(`/api/users/${u.id}`, { method: "DELETE" }).then(load)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
