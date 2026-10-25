import { useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";

// Shown when login is on (AUTH_TOKEN or users exist) and no valid token cookie is present.
export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/login", { body: { token: token.trim() } });
      onLogin();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="login">
      <form className="modal" onSubmit={submit}>
        <h3>Claudestra</h3>
        <p className="muted small">Paste your access token (AUTH_TOKEN, or one created with <code>npm run user -- add NAME</code>).</p>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="token" autoFocus />
        {error && <div className="error small">{error}</div>}
        <button type="submit" className="btn-primary" disabled={!token.trim()}>
          Log in
        </button>
      </form>
    </div>
  );
}
