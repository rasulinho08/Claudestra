import { useEffect, useState, type ChangeEvent } from "react";
import type { ApprovalMode, Profile } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";
import { go } from "../router.ts";
import { WorkflowEditor, type EditorStep } from "../WorkflowEditor.tsx";

type Param = { key: string; label: string; default: string };
type Workflow = {
  id: string; name: string; description: string; prompt: string; params: Param[]; steps: EditorStep[]; summary: string;
  positions: Record<string, { x: number; y: number }>; version: number; updatedAt: string; versions?: { version: number; createdAt: string }[];
};
type Template = Omit<Workflow, "version" | "updatedAt" | "versions">;
type Trigger = {
  id: string; workflowId: string; kind: "schedule" | "webhook"; cron: string; params: Record<string, string>; profile: Profile; approvalMode: ApprovalMode;
  enabled: boolean; name: string; secret: string; lastRunAt: string | null; lastRunId: string | null; lastError: string | null; nextRunAt: string | null;
};
type AgentLite = { id: string; name: string; color: string; icon: string; description: string };

const CRON_PRESETS: Array<[string, string]> = [
  ["0 9 * * 1-5", "weekdays 09:00"],
  ["0 8 * * *", "every day 08:00"],
  ["0 * * * *", "every hour"],
  ["*/15 * * * *", "every 15 min"],
  ["0 10 * * 1", "Mondays 10:00"],
];

type Mode = "view" | "json" | "visual";

// Saved workflows (docs/04 "Workflow"): run a fixed plan with parameters, edit it visually or as JSON,
// keep versions, trigger it on a schedule or by webhook, and share it as JSON / templates.
export function WorkflowsPage() {
  const [list, setList] = useState<Workflow[]>([]);
  const [open, setOpen] = useState<Workflow | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [values, setValues] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<Profile>("balanced");
  const [json, setJson] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [agents, setAgents] = useState<AgentLite[]>([]);

  const load = () => api<Workflow[]>("/api/workflows").then(setList).catch((e) => setStatus(errorText(e)));
  useEffect(() => {
    load();
    api<AgentLite[]>("/api/agents").then(setAgents).catch(() => {});
  }, []);

  async function select(id: string) {
    const wf = await api<Workflow>(`/api/workflows/${id}`);
    setOpen(wf);
    setValues(Object.fromEntries(wf.params.map((p) => [p.key, p.default])));
    setMode("view");
    setStatus(null);
  }

  async function createFrom(body: unknown) {
    try {
      const wf = await api<Workflow>("/api/workflows", { body });
      setTemplates(null);
      await load();
      await select(wf.id);
      return wf;
    } catch (err) {
      setStatus(errorText(err));
    }
  }

  async function createBlank() {
    const name = window.prompt("Name for the new workflow", "New workflow");
    if (!name) return;
    const wf = await createFrom({ name, steps: [{ id: "s1", agent: "researcher", task: "Research: {{prompt}}", dependsOn: [] }] });
    if (wf) setMode("visual");
  }

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await createFrom(JSON.parse(await file.text()));
    } catch (err) {
      setStatus(`Import failed: ${errorText(err)}`);
    }
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

  async function saveWorkflow(patch: Partial<Workflow>) {
    if (!open) return;
    const { name, description, prompt, params, steps, summary, positions } = { ...open, ...patch };
    try {
      const wf = await api<Workflow>(`/api/workflows/${open.id}`, { method: "PUT", body: { name, description, prompt, params, steps, summary, positions } });
      await select(wf.id);
      setStatus(`Saved as version ${wf.version}.`);
      load();
    } catch (err) {
      setStatus(errorText(err));
    }
  }

  function startJson() {
    if (!open) return;
    const { name, description, prompt, params, steps, summary } = open;
    setJson(JSON.stringify({ name, description, prompt, params, steps, summary }, null, 2));
    setMode("json");
  }

  async function remove() {
    if (!open || !window.confirm(`Delete workflow "${open.name}"?`)) return;
    await api(`/api/workflows/${open.id}`, { method: "DELETE" });
    setOpen(null);
    load();
  }

  if (open && mode === "visual") {
    return (
      <WorkflowEditor
        steps={open.steps}
        positions={open.positions}
        agents={agents}
        onCancel={() => setMode("view")}
        onSave={(steps, positions) => saveWorkflow({ steps, positions })}
      />
    );
  }

  return (
    <div className="lib-page">
      <div className="lib-list">
        <div className="lib-head">
          <h2>Workflows</h2>
        </div>
        <div className="row-gap">
          <button className="btn-primary" onClick={createBlank}>
            + New
          </button>
          <button className="ghost" onClick={() => api<Template[]>("/api/templates").then(setTemplates).catch((e) => setStatus(errorText(e)))}>
            From template
          </button>
          <label className="ghost file-btn">
            Import JSON
            <input type="file" accept="application/json,.json" onChange={importFile} hidden />
          </label>
        </div>
        {list.length === 0 && <p className="muted small">No workflows yet. Start from a template, build one visually, or save a finished team run (Answer tab → “Save as workflow”).</p>}
        {list.map((w) => (
          <button key={w.id} className={`lib-card ${open?.id === w.id ? "active" : ""}`} onClick={() => select(w.id)}>
            <div>
              <strong>☆ {w.name}</strong> <span className="muted small">v{w.version} · {w.steps.length} steps</span>
            </div>
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
        {status && <div className="small muted">{status}</div>}
        {templates ? (
          <TemplateGallery templates={templates} onPick={(id) => createFrom({ fromTemplate: id })} onClose={() => setTemplates(null)} />
        ) : !open ? (
          <p className="muted">Pick a workflow to run, edit or schedule it.</p>
        ) : mode === "json" ? (
          <>
            <div className="lib-head">
              <h3>Edit {open.name} (JSON)</h3>
              <div className="row-gap">
                <button className="ghost" onClick={() => setMode("view")}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    try {
                      saveWorkflow(JSON.parse(json));
                    } catch (err) {
                      setStatus(errorText(err));
                    }
                  }}
                >
                  Save new version
                </button>
              </div>
            </div>
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
                <button className="ghost" onClick={() => setMode("visual")}>
                  ✎ Visual editor
                </button>
                <button className="ghost" onClick={startJson}>
                  JSON
                </button>
                <a className="ghost" href={`/api/workflows/${open.id}/export`} download>
                  Export
                </a>
                <button className="ghost" onClick={remove}>
                  Delete
                </button>
              </div>
            </div>
            {open.description && <p className="muted small">{open.description}</p>}
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
                <button className="btn-primary" onClick={run}>
                  ▶ Run workflow
                </button>
              </div>
            </div>
            <ol className="plan-list">
              {open.steps.map((s) => (
                <li key={s.id}>
                  <strong>{s.agent}</strong>{" "}
                  <span className="muted small">
                    ({s.id}
                    {s.dependsOn.length ? ` ← ${s.dependsOn.join(", ")}` : ""}
                    {s.loopBackTo ? `, sends back to ${s.loopBackTo}` : ""})
                  </span>
                  <div className="small">{s.task}</div>
                </li>
              ))}
            </ol>
            <Triggers workflow={open} />
            {open.versions && open.versions.length > 1 && (
              <p className="small muted">Versions: {open.versions.map((v) => `v${v.version} (${new Date(v.createdAt).toLocaleDateString()})`).join(", ")}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TemplateGallery({ templates, onPick, onClose }: { templates: Template[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="lib-head">
        <h3>Templates</h3>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="small muted">
        Ready-made workflows from <code>templates/</code>. Share your own by exporting a workflow and dropping the JSON into that folder (or sending it to someone to import).
      </p>
      <div className="app-grid">
        {templates.map((t) => (
          <div key={t.id} className="app-card">
            <strong>☆ {t.name}</strong>
            <div className="small muted">{t.description}</div>
            <div className="tags">
              {t.steps.map((s) => (
                <span key={s.id} className="tag">
                  {s.agent}
                </span>
              ))}
            </div>
            <button className="btn-primary" onClick={() => onPick(t.id)}>
              Use template
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function Triggers({ workflow }: { workflow: Workflow }) {
  const [list, setList] = useState<Trigger[]>([]);
  const [kind, setKind] = useState<"schedule" | "webhook">("schedule");
  const [cron, setCron] = useState(CRON_PRESETS[0]![0]);
  const [prompt, setPrompt] = useState("");
  const [profile, setProfile] = useState<Profile>("eco");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("smart");
  const [error, setError] = useState<string | null>(null);

  const load = () => api<Trigger[]>("/api/triggers").then((all) => setList(all.filter((t) => t.workflowId === workflow.id))).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, [workflow.id]);

  async function add() {
    setError(null);
    try {
      await api("/api/triggers", { body: { workflowId: workflow.id, kind, cron: kind === "schedule" ? cron : "", params: prompt ? { prompt } : {}, profile, approvalMode } });
      setPrompt("");
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const toggle = (t: Trigger) => api(`/api/triggers/${t.id}`, { method: "PUT", body: { ...t, enabled: !t.enabled } }).then(load).catch((e) => setError(errorText(e)));
  const url = (t: Trigger) => `${window.location.origin.replace(":5173", ":8787")}/api/triggers/${t.id}/fire`;

  return (
    <div className="card triggers">
      <h3>Triggers</h3>
      <p className="small muted">
        Run this workflow on a schedule or when a webhook arrives (GitHub, Zapier, curl…). Triggered runs have nobody watching: risky actions still wait for approval in the UI, and the
        daily/monthly caps apply.
      </p>
      {list.map((t) => (
        <div key={t.id} className="trigger-row">
          <div className="row-between">
            <span>
              <strong>{t.kind === "schedule" ? `⏰ ${t.cron}` : "🔗 webhook"}</strong> <span className="chip">{t.profile}</span> <span className="chip">{t.approvalMode}</span>{" "}
              {!t.enabled && <span className="chip chip-warn">off</span>}
            </span>
            <span className="row-gap">
              <button className="ghost" onClick={() => api<{ runId: string }>(`/api/triggers/${t.id}/run`, { body: {} }).then((r) => go("runs", { run: r.runId })).catch((e) => setError(errorText(e)))}>
                Run now
              </button>
              <button className="ghost" onClick={() => toggle(t)}>
                {t.enabled ? "Disable" : "Enable"}
              </button>
              <button className="ghost" onClick={() => api(`/api/triggers/${t.id}`, { method: "DELETE" }).then(load)}>
                Delete
              </button>
            </span>
          </div>
          <div className="small muted">
            {t.nextRunAt && `next ${new Date(t.nextRunAt).toLocaleString()} · `}
            {t.lastRunAt ? `last ${new Date(t.lastRunAt).toLocaleString()}` : "never ran"}
            {t.lastError && <span className="bad-text"> · {t.lastError}</span>}
            {t.lastRunId && (
              <>
                {" "}
                ·{" "}
                <button className="linkish small" onClick={() => go("runs", { run: t.lastRunId! })}>
                  last run →
                </button>
              </>
            )}
          </div>
          {t.kind === "webhook" && t.secret && (
            <details className="small">
              <summary>Webhook URL and secret</summary>
              <div>
                URL: <code>{url(t)}</code>
              </div>
              <div>
                Secret: <code>{t.secret}</code>
              </div>
              <div className="muted">
                curl: <code>{`curl -X POST "${url(t)}?secret=${t.secret}" -H "content-type: application/json" -d "{\\"prompt\\":\\"...\\"}"`}</code>
              </div>
              <div className="muted">
                GitHub: Settings → Webhooks → Payload URL = the URL above, Content type = application/json, Secret = the secret. Issue/PR title and body become the prompt. GitHub
                needs a public URL: use a tunnel (cloudflared / ngrok) while running locally.
              </div>
            </details>
          )}
        </div>
      ))}
      <div className="row-gap">
        <select value={kind} onChange={(e) => setKind(e.target.value as "schedule" | "webhook")}>
          <option value="schedule">Schedule</option>
          <option value="webhook">Webhook</option>
        </select>
        {kind === "schedule" && (
          <>
            <input value={cron} onChange={(e) => setCron(e.target.value)} title="minute hour day month weekday" style={{ width: 130 }} />
            <select value="" onChange={(e) => e.target.value && setCron(e.target.value)}>
              <option value="">presets…</option>
              {CRON_PRESETS.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </select>
          </>
        )}
        <input className="grow" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === "schedule" ? "Request for each run ({{prompt}})" : "Default request (payload overrides)"} />
        <select value={profile} onChange={(e) => setProfile(e.target.value as Profile)}>
          <option value="eco">eco</option>
          <option value="balanced">balanced</option>
          <option value="max">max</option>
        </select>
        <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as ApprovalMode)}>
          <option value="smart">smart</option>
          <option value="auto">auto</option>
          <option value="manual">manual</option>
        </select>
        <button className="btn-primary" onClick={add}>
          Add trigger
        </button>
      </div>
      {error && <div className="error small">{error}</div>}
    </div>
  );
}
