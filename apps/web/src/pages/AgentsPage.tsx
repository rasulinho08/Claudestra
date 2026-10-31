import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { iconFor } from "../icons.ts";
import { t } from "../i18n.ts";

type Agent = {
  id: string; name: string; description: string; color: string; icon: string; modelClass: string;
  tools: string[]; skills: string[]; integrations: string[]; requiresApproval: string[];
  limits: { maxTurns: number; maxBudgetUsd: number }; source: string;
};

const TEMPLATE = (id: string) => `---
id: ${id}
name: ${id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
description: What this agent does and when the CEO should use it.
modelClass: mid
tools: [Read, Glob, Grep]
skills: []
limits:
  maxTurns: 12
  maxBudgetUsd: 0.30
color: "#64748b"
icon: bot
---
You are the ${id}. Describe how this agent works here.
`;

// Agent roster editor (docs/07 "Library screens"): edits agents/*.md through the API.
export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const load = () => api<Agent[]>("/api/agents").then(setAgents).catch((e) => setStatus(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  function edit(a: Agent) {
    setOpen(a.id);
    setDraft(a.source);
    setStatus(null);
  }

  function create() {
    const id = window.prompt("New agent id (lowercase, dashes)", "translator");
    if (!id) return;
    setOpen(id);
    setDraft(TEMPLATE(id));
    setStatus("New agent: save to create agents/" + id + ".md");
  }

  async function saveAgent() {
    if (!open) return;
    try {
      await api(`/api/agents/${open}`, { method: "PUT", body: { source: draft } });
      setStatus("Saved. New runs use this definition.");
      load();
    } catch (err) {
      setStatus(errorText(err));
    }
  }

  return (
    <div className="lib-page">
      <div className="lib-list">
        <div className="lib-head">
          <h2>{t("nav.agents")}</h2>
          <button className="ghost" onClick={create}>
            + New agent
          </button>
        </div>
        {agents.map((a) => (
          <button key={a.id} className={`lib-card ${open === a.id ? "active" : ""}`} style={{ borderLeftColor: a.color }} onClick={() => edit(a)}>
            <div>
              <strong style={{ color: a.color }}>
                {iconFor(a.icon)} {a.name}
              </strong>{" "}
              <span className="muted small">· {a.modelClass} · {a.limits.maxTurns} turns · ${a.limits.maxBudgetUsd}</span>
            </div>
            <div className="small muted">{a.description}</div>
            <div className="tags">
              {a.tools.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
              {a.skills.map((s) => (
                <span key={s} className="tag tag-skill">
                  ✦ {s}
                </span>
              ))}
              {a.integrations.map((i) => (
                <span key={i} className="tag tag-app">
                  ⧉ {i}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <div className="lib-editor">
        {open ? (
          <>
            <div className="lib-head">
              <h3>agents/{open}.md</h3>
              <button onClick={saveAgent}>Save</button>
            </div>
            {status && <div className="small muted">{status}</div>}
            <textarea className="code-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            <p className="small muted">
              Frontmatter: <code>tools</code> (Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch), <code>skills</code> (folders in skills/),{" "}
              <code>integrations</code> ("github" or "github:search_*"), <code>requiresApproval</code> ("Bash:*npm install*"), <code>modelClass</code> (cheap, mid, strong).
            </p>
          </>
        ) : (
          <p className="muted">Pick an agent to edit its prompt, tools, skills and limits.</p>
        )}
      </div>
    </div>
  );
}
