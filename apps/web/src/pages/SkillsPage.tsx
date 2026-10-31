import { useEffect, useMemo, useState } from "react";
import { ApiError, api, errorText } from "../api.ts";
import { agentName, t } from "../i18n.ts";

type Skill = { name: string; description: string; usedBy: string[] };
type Agent = { id: string; name: string; color: string };

const TEMPLATE = (name: string) => `---
name: ${name}
description: Use when … (one sentence saying when an agent should load this skill).
---
# ${name}

Instructions the agent follows when it loads this skill.
`;

// Skill library (docs/05 "Skills", upgrade A2): skills/<name>/SKILL.md. Attach to agents with one click, import from
// GitHub, edit. Skills work on every engine (Claude natively; Gemini/Meta/OpenAI-compatible through the Skill tool).
export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);

  const load = () => api<Skill[]>("/api/skills").then(setSkills).catch((e) => setStatus({ text: errorText(e), error: true }));
  useEffect(() => {
    load();
    api<Agent[]>("/api/agents")
      .then((a) => setAgents(a.filter((x) => x.id !== "ceo")))
      .catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? skills.filter((s) => s.name.includes(q) || s.description.toLowerCase().includes(q)) : skills;
  }, [skills, filter]);
  const current = skills.find((s) => s.name === open);

  async function edit(name: string) {
    setOpen(name);
    setIsNew(false);
    setStatus(null);
    try {
      setDraft((await api<{ source: string }>(`/api/skills/${name}`)).source);
    } catch (err) {
      setStatus({ text: errorText(err), error: true });
    }
  }

  function create() {
    const name = window.prompt(t("skills.newName"), "my-skill");
    if (!name) return;
    setOpen(name);
    setIsNew(true);
    setDraft(TEMPLATE(name));
    setStatus({ text: t("skills.newHint") });
  }

  async function saveSkill() {
    if (!open) return;
    try {
      await api(`/api/skills/${open}`, { method: "PUT", body: { source: draft } });
      setStatus({ text: t("skills.saved") });
      setIsNew(false);
      load();
    } catch (err) {
      setStatus({ text: errorText(err), error: true });
    }
  }

  async function toggle(agentId: string, on: boolean) {
    if (!current) return;
    const next = on ? [...current.usedBy, agentId] : current.usedBy.filter((a) => a !== agentId);
    setSkills(skills.map((s) => (s.name === current.name ? { ...s, usedBy: next } : s)));
    try {
      await api(`/api/skills/${current.name}/agents`, { method: "PUT", body: { agents: next } });
    } catch (err) {
      setStatus({ text: errorText(err), error: true });
    }
    load();
  }

  async function importFromGitHub(url?: string) {
    const link = url ?? window.prompt(t("skills.importPrompt"), "https://github.com/");
    if (!link) return;
    setImporting(true);
    setStatus(null);
    try {
      const r = await api<{ name: string; files: string[] }>("/api/skills/import", { body: { url: link } });
      await load();
      await edit(r.name);
      setStatus({ text: t("skills.imported", { name: r.name, n: r.files.length }) });
    } catch (err) {
      const choices = err instanceof ApiError && Array.isArray(err.body.choices) ? (err.body.choices as string[]) : [];
      setStatus({ text: errorText(err) + (choices.length ? `\n${choices.join("\n")}` : ""), error: true });
    } finally {
      setImporting(false);
    }
  }

  async function remove() {
    if (!current || !window.confirm(t("skills.confirmDelete", { name: current.name }))) return;
    try {
      await api(`/api/skills/${current.name}`, { method: "DELETE" });
      setOpen(null);
      load();
    } catch (err) {
      setStatus({ text: errorText(err), error: true });
    }
  }

  return (
    <div className="lib-page">
      <div className="lib-list">
        <div className="lib-head">
          <h2>
            {t("nav.skills")} <span className="muted small">({skills.length})</span>
          </h2>
          <div className="row-gap">
            <button className="ghost" onClick={() => importFromGitHub()} disabled={importing} title={t("skills.importTitle")}>
              {importing ? "…" : `⬇ ${t("skills.import")}`}
            </button>
            <button className="ghost" onClick={create}>
              + {t("skills.new")}
            </button>
          </div>
        </div>
        <p className="small muted">{t("skills.intro")}</p>
        <input className="lib-filter" placeholder={t("skills.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {shown.map((s) => (
          <button key={s.name} className={`lib-card ${open === s.name ? "active" : ""}`} onClick={() => edit(s.name)}>
            <strong>✦ {s.name}</strong>
            <div className="small muted">{s.description}</div>
            <div className="tags">
              {s.usedBy.length === 0 ? (
                <span className="small muted">{t("skills.unused")}</span>
              ) : (
                s.usedBy.map((a) => (
                  <span key={a} className="tag">
                    {agentName(a, agents.find((x) => x.id === a)?.name ?? a)}
                  </span>
                ))
              )}
            </div>
          </button>
        ))}
      </div>
      <div className="lib-editor">
        {open ? (
          <>
            <div className="lib-head">
              <h3>skills/{open}/SKILL.md</h3>
              <div className="row-gap">
                {current && (
                  <button className="ghost" onClick={remove}>
                    {t("skills.delete")}
                  </button>
                )}
                <button onClick={saveSkill}>{t("skills.save")}</button>
              </div>
            </div>
            {current && !isNew && (
              <div className="attach">
                <span className="small muted">{t("skills.attach")}</span>
                <div className="attach-list">
                  {agents.map((a) => (
                    <label key={a.id} className="attach-item" style={{ borderColor: current.usedBy.includes(a.id) ? a.color : undefined }}>
                      <input type="checkbox" checked={current.usedBy.includes(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
                      {agentName(a.id, a.name)}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {status && <div className={`small ${status.error ? "error" : "muted"}`} style={{ whiteSpace: "pre-wrap" }}>{status.text}</div>}
            <textarea className="code-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          </>
        ) : (
          <>
            {status && <div className={`small ${status.error ? "error" : "muted"}`} style={{ whiteSpace: "pre-wrap" }}>{status.text}</div>}
            <p className="muted">{t("skills.pick")}</p>
          </>
        )}
      </div>
    </div>
  );
}
