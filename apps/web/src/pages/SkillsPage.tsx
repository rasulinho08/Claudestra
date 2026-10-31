import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { t } from "../i18n.ts";

type Skill = { name: string; description: string; usedBy: string[] };

const TEMPLATE = (name: string) => `---
name: ${name}
description: One sentence saying when to use this skill.
---
# ${name}

Instructions the agent follows when it loads this skill.
`;

// Skill library (docs/05 "Skills"): skills/<name>/SKILL.md; attach skills to agents in their frontmatter.
export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const load = () => api<Skill[]>("/api/skills").then(setSkills).catch((e) => setStatus(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  async function edit(name: string) {
    setOpen(name);
    setStatus(null);
    try {
      setDraft((await api<{ source: string }>(`/api/skills/${name}`)).source);
    } catch (err) {
      setStatus(errorText(err));
    }
  }

  function create() {
    const name = window.prompt("New skill name (lowercase, dashes)", "my-skill");
    if (!name) return;
    setOpen(name);
    setDraft(TEMPLATE(name));
    setStatus("New skill: save, then add it to an agent's skills list.");
  }

  async function saveSkill() {
    if (!open) return;
    try {
      await api(`/api/skills/${open}`, { method: "PUT", body: { source: draft } });
      setStatus("Saved.");
      load();
    } catch (err) {
      setStatus(errorText(err));
    }
  }

  return (
    <div className="lib-page">
      <div className="lib-list">
        <div className="lib-head">
          <h2>{t("nav.skills")}</h2>
          <button className="ghost" onClick={create}>
            + New skill
          </button>
        </div>
        <p className="small muted">Only an agent's own skills are copied into its workspace, and the body loads only when used, so unused skills cost almost nothing.</p>
        {skills.map((s) => (
          <button key={s.name} className={`lib-card ${open === s.name ? "active" : ""}`} onClick={() => edit(s.name)}>
            <strong>✦ {s.name}</strong>
            <div className="small muted">{s.description}</div>
            <div className="tags">
              {s.usedBy.length === 0 ? <span className="small muted">not attached to any agent</span> : s.usedBy.map((a) => <span key={a} className="tag">{a}</span>)}
            </div>
          </button>
        ))}
      </div>
      <div className="lib-editor">
        {open ? (
          <>
            <div className="lib-head">
              <h3>skills/{open}/SKILL.md</h3>
              <button onClick={saveSkill}>Save</button>
            </div>
            {status && <div className="small muted">{status}</div>}
            <textarea className="code-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          </>
        ) : (
          <p className="muted">Pick a skill to view or edit it.</p>
        )}
      </div>
    </div>
  );
}
