import { useEffect, useState } from "react";
import type { SessionInfo } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";
import { iconFor } from "../icons.ts";
import { agentName, t } from "../i18n.ts";

type Agent = {
  id: string; name: string; persona?: string; style: string; trained: number; description: string; color: string; icon: string; modelClass: string;
  tools: string[]; skills: string[]; integrations: string[]; requiresApproval: string[];
  limits: { maxTurns: number; maxBudgetUsd: number }; source: string;
  budget?: { monthlyUsd: number | null; spentUsd: number; over: boolean };
};
type TrainingItem = { id: string; kind: "instruction" | "lesson"; rating: "up" | "down" | null; text: string; runId: string | null; createdAt: string };

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

// The team (docs/03): give each agent a person's name and working style, train it separately (instructions and
// lessons from rated work), or edit its agents/<id>.md file directly.
export function AgentsPage({ session }: { session?: SessionInfo | null }) {
  // The owner edits everything; a teammate names, trains and picks skills for their own agent only.
  const isOwner = (session?.user?.role ?? "owner") === "owner";
  const myAgent = session?.user?.agentId ?? null;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"profile" | "file">("profile");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [isNew, setIsNew] = useState(false);

  const load = () => api<Agent[]>("/api/agents").then(setAgents).catch((e) => setStatus({ text: errorText(e), error: true }));
  useEffect(() => {
    load();
  }, []);
  const current = agents.find((a) => a.id === open);

  function select(a: Agent) {
    setTab("profile");
    setOpen(a.id);
    setDraft(a.source);
    setStatus(null);
    setIsNew(false);
  }

  function create() {
    const id = window.prompt("New agent id (lowercase, dashes)", "content-writer");
    if (!id) return;
    setOpen(id);
    setDraft(TEMPLATE(id));
    setTab("file");
    setIsNew(true);
    setStatus({ text: `agents/${id}.md` });
  }

  async function saveFile() {
    if (!open) return;
    try {
      await api(`/api/agents/${open}`, { method: "PUT", body: { source: draft } });
      setStatus({ text: t("agents.saved") });
      setIsNew(false);
      load();
    } catch (err) {
      setStatus({ text: errorText(err), error: true });
    }
  }

  return (
    <div className="lib-page">
      <div className="lib-list">
        <div className="lib-head">
          <h2>{t("nav.agents")}</h2>
          {isOwner && (
            <button className="ghost" onClick={create}>
              + {t("agents.new")}
            </button>
          )}
        </div>
        {agents.map((a) => (
          <button key={a.id} className={`lib-card ${open === a.id ? "active" : ""}`} style={{ borderLeftColor: a.color }} onClick={() => select(a)}>
            <div>
              <strong style={{ color: a.color }}>
                {iconFor(a.icon)} {a.persona || agentName(a.id, a.name)}
              </strong>{" "}
              {a.persona && <span className="small">· {agentName(a.id, a.name)}</span>}{" "}
              <span className="muted small">· {a.modelClass}</span>
            </div>
            <div className="small muted">{a.description}</div>
            <div className="tags">
              {a.budget?.over && <span className="tag tag-warn">💰 {t("agents.budgetOver")}</span>}
              {a.trained > 0 && <span className="tag tag-train">🎓 {t("agents.trained", { n: a.trained })}</span>}
              {a.skills.slice(0, 4).map((s) => (
                <span key={s} className="tag tag-skill">
                  ✦ {s}
                </span>
              ))}
              {a.skills.length > 4 && <span className="tag">+{a.skills.length - 4}</span>}
              {[...new Set(a.integrations.map((i) => i.split(":")[0]!))].map((i) => (
                <span key={i} className="tag tag-app">
                  ⧉ {i}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <div className="lib-editor">
        {!open ? (
          <p className="muted">{t("agents.pick")}</p>
        ) : (
          <>
            <div className="tabs agent-tabs">
              <button className={tab === "profile" ? "active" : ""} disabled={isNew} onClick={() => setTab("profile")}>
                🎓 {t("agents.profile")}
              </button>
              {isOwner && (
                <button className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}>
                  {t("agents.file")}
                </button>
              )}
            </div>
            {status && <div className={`small ${status.error ? "error" : "muted"}`}>{status.text}</div>}
            {tab === "profile" && current ? (
              !isOwner && current.id !== myAgent ? (
                <p className="muted">{t("agents.onlyOwn")}</p>
              ) : (
                <Profile key={current.id} agent={current} onSaved={load} isOwner={isOwner} />
              )
            ) : (
              <>
                <div className="lib-head">
                  <h3>agents/{open}.md</h3>
                  <button onClick={saveFile}>{t("skills.save")}</button>
                </div>
                <textarea className="code-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
                <p className="small muted">
                  Frontmatter: <code>persona</code>, <code>style</code>, <code>tools</code> (Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch), <code>skills</code>,{" "}
                  <code>integrations</code> ("apify" or "github:search_*"), <code>requiresApproval</code>, <code>modelClass</code> (cheap, mid, strong).
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Profile({ agent, onSaved, isOwner }: { agent: Agent; onSaved: () => void; isOwner: boolean }) {
  const [persona, setPersona] = useState(agent.persona ?? "");
  const [style, setStyle] = useState(agent.style ?? "");
  const [items, setItems] = useState<TrainingItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const role = agentName(agent.id, agent.name);

  const loadTraining = () =>
    api<{ items: TrainingItem[]; prompt: string }>(`/api/agents/${agent.id}/training`)
      .then((r) => {
        setItems(r.items);
        setPrompt(r.prompt);
      })
      .catch((e) => setMsg({ text: errorText(e), error: true }));
  useEffect(() => {
    loadTraining();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  async function saveProfile() {
    try {
      await api(`/api/agents/${agent.id}/persona`, { method: "PUT", body: { persona, style } });
      setMsg({ text: t("agents.saved") });
      onSaved();
    } catch (err) {
      setMsg({ text: errorText(err), error: true });
    }
  }

  async function addInstruction() {
    if (!instruction.trim()) return;
    try {
      await api(`/api/agents/${agent.id}/training`, { body: { kind: "instruction", text: instruction } });
      setInstruction("");
      loadTraining();
      onSaved();
    } catch (err) {
      setMsg({ text: errorText(err), error: true });
    }
  }

  async function remove(id: string) {
    await api(`/api/agents/${agent.id}/training/${id}`, { method: "DELETE" }).catch(() => {});
    loadTraining();
    onSaved();
  }

  const [allSkills, setAllSkills] = useState<{ name: string; description: string }[]>([]);
  const [picked, setPicked] = useState<string[]>(agent.skills);
  const [skillMsg, setSkillMsg] = useState<string | null>(null);
  useEffect(() => {
    api<{ name: string; description: string }[]>("/api/skills").then(setAllSkills).catch(() => {});
  }, []);
  async function saveSkills() {
    try {
      await api(`/api/agents/${agent.id}/skills`, { method: "PUT", body: { skills: picked } });
      setSkillMsg(t("agents.saved"));
      onSaved();
    } catch (err) {
      setSkillMsg(errorText(err));
    }
  }

  const instructions = items.filter((i) => i.kind === "instruction");
  const lessons = items.filter((i) => i.kind === "lesson");
  return (
    <div className="agent-profile">
      <div className="profile-head" style={{ borderColor: agent.color }}>
        <span className="profile-icon" style={{ color: agent.color }}>
          {iconFor(agent.icon)}
        </span>
        <div>
          <h3>{persona || role}</h3>
          <div className="small muted">
            {role} · {agent.description}
          </div>
        </div>
      </div>
      <label className="field">
        <span className="small muted">{t("agents.personName")}</span>
        <input value={persona} maxLength={60} onChange={(e) => setPersona(e.target.value)} placeholder={t("agents.personPlaceholder")} />
      </label>
      <label className="field">
        <span className="small muted">{t("agents.style")}</span>
        <textarea rows={2} maxLength={600} value={style} onChange={(e) => setStyle(e.target.value)} placeholder={t("agents.stylePlaceholder")} />
      </label>
      <div className="row-gap">
        <button onClick={saveProfile}>{t("agents.saveProfile")}</button>
        {msg && <span className={`small ${msg.error ? "error" : "muted"}`}>{msg.text}</span>}
      </div>

      {isOwner && agent.id !== "ceo" && <BudgetBox agent={agent} onSaved={onSaved} />}

      <h4>{t("agents.instructions")}</h4>
      <p className="small muted">{t("agents.instructionsHelp")}</p>
      <div className="train-add">
        <textarea rows={2} maxLength={1000} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t("agents.instructionPlaceholder")} />
        <button className="ghost" onClick={addInstruction} disabled={!instruction.trim()}>
          + {t("agents.addInstruction")}
        </button>
      </div>
      {items.length === 0 && <p className="small muted">{t("agents.noTraining")}</p>}
      {instructions.map((i) => (
        <div key={i.id} className="train-item">
          <span>📌 {i.text}</span>
          <button className="linkish small" onClick={() => remove(i.id)} title={t("skills.delete")}>
            ✕
          </button>
        </div>
      ))}
      {lessons.length > 0 && <h4>{t("agents.lessons")}</h4>}
      {lessons.map((i) => (
        <div key={i.id} className={`train-item lesson-${i.rating ?? "note"}`}>
          <span>
            {i.rating === "up" ? "👍" : i.rating === "down" ? "👎" : "•"} {i.text}{" "}
            {i.runId && (
              <a className="small" href={`#/runs?run=${i.runId}`}>
                ↗
              </a>
            )}
          </span>
          <button className="linkish small" onClick={() => remove(i.id)} title={t("skills.delete")}>
            ✕
          </button>
        </div>
      ))}
      <h4>{t("agents.skillsTitle")}</h4>
      <p className="small muted">{t("agents.skillsHelp")}</p>
      <div className="skill-picker">
        {allSkills.map((s) => (
          <label key={s.name} className={`attach-item ${picked.includes(s.name) ? "on" : ""}`} title={s.description} style={{ borderColor: picked.includes(s.name) ? agent.color : undefined }}>
            <input type="checkbox" checked={picked.includes(s.name)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.name] : picked.filter((x) => x !== s.name))} />
            {s.name}
          </label>
        ))}
      </div>
      <div className="row-gap">
        <button className="ghost" onClick={saveSkills}>
          {t("agents.saveSkills")}
        </button>
        {skillMsg && <span className="small muted">{skillMsg}</span>}
      </div>
      {prompt && (
        <details className="card">
          <summary className="small">{t("agents.preview")}</summary>
          <pre className="small">{prompt}</pre>
        </details>
      )}
    </div>
  );
}

// Monthly spending cap for this agent (owner only). Empty or 0 means no cap.
function BudgetBox({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const b = agent.budget ?? { monthlyUsd: null, spentUsd: 0, over: false };
  const [value, setValue] = useState(b.monthlyUsd === null ? "" : String(b.monthlyUsd));
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    const n = Number(value.replace(",", "."));
    try {
      await api(`/api/agents/${agent.id}/budget`, { method: "PUT", body: { monthlyUsd: value.trim() && n > 0 ? n : null } });
      setMsg(t("agents.saved"));
      onSaved();
    } catch (err) {
      setMsg(errorText(err));
    }
  }
  const share = b.monthlyUsd ? Math.min(1, b.spentUsd / b.monthlyUsd) : 0;
  return (
    <div className={`budget-box ${b.over ? "over" : ""}`}>
      <h4>💰 {t("agents.budget")}</h4>
      <p className="small muted">{t("agents.budgetHelp")}</p>
      <div className="row-gap">
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="$" aria-label={t("agents.budget")} style={{ width: 110 }} />
        <button className="ghost" onClick={() => void save()}>
          {t("skills.save")}
        </button>
        <span className="small muted">
          {t("agents.budgetSpent", { n: b.spentUsd.toFixed(2) })}
          {msg ? ` · ${msg}` : ""}
        </span>
      </div>
      {b.monthlyUsd !== null && (
        <div className="mission-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={t("agents.budget")}>
          <span style={{ width: `${share * 100}%`, background: b.over ? "var(--fail)" : undefined }} />
        </div>
      )}
      {b.over && <div className="error small">{t("agents.budgetStopped")}</div>}
    </div>
  );
}
