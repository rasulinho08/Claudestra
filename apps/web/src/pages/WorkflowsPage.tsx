import { useEffect, useState } from "react";
import type { Profile } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";
import { go } from "../router.ts";

type Param = { key: string; label: string; default: string };
type Step = { id: string; agent: string; task: string; dependsOn: string[]; successCriteria: string; loopBackTo: string };
type Workflow = { id: string; name: string; description: string; prompt: string; params: Param[]; steps: Step[]; summary: string; version: number; updatedAt: string; versions?: { version: number; createdAt: string }[] };

// Saved workflows (docs/04 "Workflow"): run a fixed plan with parameters, edit it as JSON, keep versions.
export function WorkflowsPage() {
  const [list, setList] = useState<Workflow[]>([]);
  const [open, setOpen] = useState<Workflow | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<Profile>("balanced");
  const [json, setJson] = useState("");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = () => api<Workflow[]>("/api/workflows").then(setList).catch((e) => setStatus(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  async function select(id: string) {
    const wf = await api<Workflow>(`/api/workflows/${id}`);
    setOpen(wf);
    setValues(Object.fromEntries(wf.params.map((p) => [p.key, p.default])));
    setEditing(false);
    setStatus(null);
  }

  async function run() {
    if (!open) return;
    try {
      const { runId } = await api<{ runId: string }>("/api/runs", { body: { workflowId: open.id, params: values, profile } });
      go("runs", { run: runId });
    } catch (err) {
      setStatus(errorText(err));
    }
  }

  function startEdit() {
    if (!open) return;
    const { name, description, prompt, params, steps, summary } = open;
    setJson(JSON.stringify({ name, description, prompt, params, steps, summary }, null, 2));
    setEditing(true);
  }

  async function saveEdit() {
    if (!open) return;
    try {
      const wf = await api<Workflow>(`/api/workflows/${open.id}`, { method: "PUT", body: JSON.parse(json) });
      setStatus(`Saved as version ${wf.version}.`);
      setEditing(false);
      await select(wf.id);
      load();
    } catch (err) {
      setStatus(errorText(err));
    }
  }

  async function remove() {
    if (!open || !window.confirm(`Delete workflow "${open.name}"?`)) return;
    await api(`/api/workflows/${open.id}`, { method: "DELETE" });
    setOpen(null);
    load();
  }

  return (
    <div className="lib-page">
      <div className="lib-list">
        <div className="lib-head">
          <h2>Workflows</h2>
        </div>
        {list.length === 0 && <p className="muted small">No workflows yet. Finish a team run, open its Answer tab and press “Save as workflow”.</p>}
        {list.map((w) => (
          <button key={w.id} className={`lib-card ${open?.id === w.id ? "active" : ""}`} onClick={() => select(w.id)}>
            <strong>☆ {w.name}</strong> <span className="muted small">v{w.version} · {w.steps.length} steps</span>
            <div className="small muted">{w.description}</div>
            <div className="tags">
              {w.steps.map((s) => (
                <span key={s.id} className="tag">
                  {s.agent}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <div className="lib-editor">
        {!open ? (
          <p className="muted">Pick a workflow to run or edit it.</p>
        ) : editing ? (
          <>
            <div className="lib-head">
              <h3>Edit {open.name}</h3>
              <div className="row-gap">
                <button className="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button onClick={saveEdit}>Save new version</button>
              </div>
            </div>
            {status && <div className="small muted">{status}</div>}
            <textarea className="code-editor" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
            <p className="small muted">
              Use <code>{"{{param}}"}</code> placeholders in <code>prompt</code> and step tasks. Step fields: id, agent, task, dependsOn, successCriteria, loopBackTo.
            </p>
          </>
        ) : (
          <>
            <div className="lib-head">
              <h3>
                {open.name} <span className="muted small">v{open.version}</span>
              </h3>
              <div className="row-gap">
                <button className="ghost" onClick={startEdit}>
                  Edit
                </button>
                <button className="ghost" onClick={remove}>
                  Delete
                </button>
              </div>
            </div>
            {status && <div className="small muted">{status}</div>}
            <div className="card">
              {open.params.map((p) => (
                <label key={p.key} className="field">
                  <span className="small muted">{p.label || p.key}</span>
                  <textarea rows={p.key === "prompt" ? 3 : 1} value={values[p.key] ?? ""} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
                </label>
              ))}
              <div className="row-gap">
                <select value={profile} onChange={(e) => setProfile(e.target.value as Profile)}>
                  <option value="eco">eco</option>
                  <option value="balanced">balanced</option>
                  <option value="max">max</option>
                </select>
                <button onClick={run}>▶ Run workflow</button>
              </div>
            </div>
            <ol className="plan-list">
              {open.steps.map((s) => (
                <li key={s.id}>
                  <strong>{s.agent}</strong>{" "}
                  <span className="muted small">
                    ({s.id}
                    {s.dependsOn.length ? ` ← ${s.dependsOn.join(", ")}` : ""}
                    {s.loopBackTo ? `, loops back to ${s.loopBackTo}` : ""})
                  </span>
                  <div className="small">{s.task}</div>
                </li>
              ))}
            </ol>
            {open.versions && open.versions.length > 1 && (
              <p className="small muted">
                Versions: {open.versions.map((v) => `v${v.version} (${new Date(v.createdAt).toLocaleDateString()})`).join(", ")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
