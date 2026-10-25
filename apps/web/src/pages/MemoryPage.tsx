import { useEffect, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { go } from "../router.ts";

type Note = { id: string; text: string; createdAt: string };
type Remembered = { runId: string; prompt: string; summary: string; createdAt: string };

// Cross-run memory (docs/04 "Context between runs"): notes every agent sees, and finished runs the CEO can recall.
export function MemoryPage() {
  const [data, setData] = useState<{ enabled: boolean; notes: Note[]; runs: Remembered[] } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ enabled: boolean; notes: Note[]; runs: Remembered[] }>("/api/memory").then(setData).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api("/api/memory/notes", { body: { text } });
      setText("");
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const remove = (url: string) => api(url, { method: "DELETE" }).then(load).catch((e) => setError(errorText(e)));

  return (
    <div className="page-scroll">
      <div className="page-narrow">
        <h2>Memory</h2>
        {data && !data.enabled && <div className="banner">Memory is off (MEMORY=off in .env).</div>}
        {error && <div className="error small">{error}</div>}
        <h3>Company notes</h3>
        <p className="muted small">Short facts every run should know ("Our stack is React + Node", "Answer in Azerbaijani"). They are added to the CEO's plan and to every agent's task, so keep them few and short.</p>
        <form className="row-gap" onSubmit={add}>
          <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…" maxLength={1000} />
          <button type="submit" className="btn-primary" disabled={!text.trim()}>
            Add
          </button>
        </form>
        {data?.notes.map((n) => (
          <div key={n.id} className="card row-between">
            <span>{n.text}</span>
            <button className="ghost" onClick={() => remove(`/api/memory/notes/${n.id}`)}>
              Delete
            </button>
          </div>
        ))}
        <h3>Remembered runs</h3>
        <p className="muted small">Each finished run is remembered as its request plus the start of its answer (no extra cost). When a new request shares enough keywords, the CEO gets up to three of them as context.</p>
        {data?.runs.length === 0 && <p className="muted small">Nothing remembered yet.</p>}
        {data?.runs.map((r) => (
          <div key={r.runId} className="card">
            <div className="row-between">
              <button className="linkish" onClick={() => go("runs", { run: r.runId })}>
                {r.prompt.slice(0, 120)}
              </button>
              <button className="ghost" onClick={() => remove(`/api/memory/runs/${r.runId}`)}>
                Forget
              </button>
            </div>
            <div className="small muted">{r.summary.slice(0, 300)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
