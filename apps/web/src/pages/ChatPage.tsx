// Chat (docs/07 "Chat"): talk to your own agent, or to the whole team, like a messenger. The team is the contact
// list; each conversation is a thread of runs that remember the earlier turns and continue in the same files.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentInfo, HealthResponse, SessionInfo } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";
import { agentName, lang, t } from "../i18n.ts";
import { iconFor } from "../icons.ts";
import { Markdown } from "../Markdown.tsx";
import { ResultsBar } from "../ResultsBar.tsx";
import { Feedback } from "../Inspector.tsx";
import { ApprovalButtons, shortPath } from "../Timeline.tsx";
import { useRunEvents } from "../useRunEvents.ts";
import { toolLine } from "../stage/world.ts";
import { agentFor } from "../graph.ts";
import { usd } from "../format.ts";
import type { RunView } from "../run-state.ts";

type Conversation = { id: string; agentId: string | null; title: string; createdBy: string | null; updatedAt: string };
type Turn = { runId: string; prompt: string; status: string; answer: string | null; error: string | null; startedAt: string; costUsd: number | null };
type Detail = Conversation & { turns: Turn[] };

const TEAM = "__team__";
const time = (iso: string) => new Date(iso).toLocaleTimeString(lang() === "az" ? "az-AZ" : undefined, { hour: "2-digit", minute: "2-digit" });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function Avatar({ agent, size = 36 }: { agent: AgentInfo | null; size?: number }) {
  const color = agent?.color ?? "#64748b";
  const label = agent ? (agent.persona ? initials(agent.persona) : iconFor(agent.icon)) : "🏢";
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.38 }} aria-hidden="true">
      {label}
    </span>
  );
}

export function ChatPage({ health, session, initialAgent }: { health: HealthResponse | null; session?: SessionInfo | null; initialAgent?: string | null }) {
  const agents = useMemo(() => (health?.agents ?? []).filter((a) => a.id !== "ceo"), [health]);
  const myAgent = session?.user?.agentId ?? null;
  const [contact, setContact] = useState<string>(initialAgent ?? myAgent ?? TEAM);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const agentOf = (id: string | null) => (id ? (agents.find((a) => a.id === id) ?? null) : null);
  const nameOf = (a: AgentInfo | null) => (a ? a.persona || agentName(a.id, a.name) : t("chat.team"));
  const contactAgent = contact === TEAM ? null : agentOf(contact);

  const loadConvs = useCallback(() => api<Conversation[]>("/api/conversations").then(setConvs).catch((e) => setError(errorText(e))), []);
  useEffect(() => {
    loadConvs();
  }, [loadConvs]);
  useEffect(() => {
    if (!initialAgent && myAgent) setContact(myAgent);
  }, [myAgent, initialAgent]);

  const threads = convs.filter((c) => (contact === TEAM ? c.agentId === null : c.agentId === contact));
  // Opening a contact shows its latest conversation (or an empty new one).
  useEffect(() => {
    setOpenId(threads[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact, convs.length]);

  const loadDetail = useCallback(
    (id: string | null) => {
      if (!id) return setDetail(null);
      api<Detail>(`/api/conversations/${id}`)
        .then(setDetail)
        .catch((e) => setError(errorText(e)));
    },
    [],
  );
  useEffect(() => loadDetail(openId), [openId, loadDetail]);

  const lastTurn = detail?.turns[detail.turns.length - 1];
  const liveRunId = lastTurn && lastTurn.status === "running" ? lastTurn.runId : null;
  const live = useRunEvents(liveRunId);
  // When the running turn ends, reload the thread to get its stored answer.
  useEffect(() => {
    if (liveRunId && ["completed", "failed", "cancelled"].includes(live.run.status)) {
      loadDetail(openId);
      loadConvs();
    }
  }, [live.run.status, liveRunId, openId, loadDetail, loadConvs]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.turns.length, live.run.lastSeq]);

  async function send() {
    const prompt = text.trim();
    if (!prompt || busy || liveRunId) return;
    setBusy(true);
    setError(null);
    try {
      let id = openId;
      if (!id) {
        const conv = await api<Conversation>("/api/conversations", { body: { agentId: contact === TEAM ? null : contact } });
        id = conv.id;
        setOpenId(id);
      }
      await api(`/api/conversations/${id}/messages`, { body: { prompt, language: lang() === "az" ? "az" : "auto" } });
      setText("");
      loadDetail(id);
      loadConvs();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function newChat() {
    setOpenId(null);
    setDetail(null);
  }

  async function removeChat() {
    if (!openId) return;
    await api(`/api/conversations/${openId}`, { method: "DELETE" }).catch(() => {});
    setOpenId(null);
    loadConvs();
  }

  const decide = (approvalId: string, decision: "approve" | "approve_run" | "reject") =>
    liveRunId && api(`/api/runs/${liveRunId}/approvals/${approvalId}`, { body: { decision, note: "" } }).catch((err) => setError(errorText(err)));

  // My agent, the whole team, then people's agents (with a person's name), then the helper roles.
  const people = agents.filter((a) => a.id !== myAgent && a.persona);
  const helpers = agents.filter((a) => a.id !== myAgent && !a.persona);
  const contacts: { id: string; agent: AgentInfo | null; section?: string }[] = [
    ...(myAgent && agentOf(myAgent) ? [{ id: myAgent, agent: agentOf(myAgent) }] : []),
    { id: TEAM, agent: null },
    ...people.map((a, i) => ({ id: a.id, agent: a, section: i === 0 ? t("chat.people") : undefined })),
    ...helpers.map((a, i) => ({ id: a.id, agent: a, section: i === 0 ? t("chat.helpers") : undefined })),
  ];

  return (
    <div className="chat-page">
      <aside className="chat-contacts">
        <div className="chat-contacts-title">{t("chat.title")}</div>
        {contacts.map((c) => [
          c.section ? (
            <div key={`s-${c.id}`} className="chat-contacts-title">
              {c.section}
            </div>
          ) : null,
          <button key={c.id} className={`contact ${contact === c.id ? "active" : ""}`} onClick={() => setContact(c.id)}>
            <Avatar agent={c.agent} />
            <span className="contact-text">
              <strong>
                {nameOf(c.agent)}
                {c.id === myAgent && <span className="contact-mine"> · {t("composer.mine")}</span>}
              </strong>
              <span className="small muted">{c.agent ? (c.agent.persona ? agentName(c.agent.id, c.agent.name) : c.agent.description.slice(0, 48)) : t("chat.teamHint")}</span>
            </span>
          </button>,
        ])}
      </aside>

      <section className="chat-main">
        <header className="chat-head">
          <Avatar agent={contactAgent} size={42} />
          <div className="chat-head-text">
            <strong>{nameOf(contactAgent)}</strong>
            <span className="small muted">{contactAgent ? agentName(contactAgent.id, contactAgent.name) : t("chat.teamHint")}</span>
          </div>
          <select className="chat-threads" value={openId ?? ""} onChange={(e) => setOpenId(e.target.value || null)} aria-label={t("chat.threads")}>
            <option value="">+ {t("chat.new")}</option>
            {threads.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || t("chat.untitled")}
              </option>
            ))}
          </select>
          {openId && (
            <>
              <button className="ghost" onClick={newChat} title={t("chat.new")}>
                ＋
              </button>
              <button className="ghost" onClick={removeChat} title={t("chat.delete")}>
                🗑
              </button>
            </>
          )}
        </header>

        <div className="chat-thread">
          {(!detail || detail.turns.length === 0) && (
            <div className="chat-empty">
              <Avatar agent={contactAgent} size={64} />
              <h2>{contactAgent ? t("chat.helloAgent", { name: nameOf(contactAgent) }) : t("chat.helloTeam")}</h2>
              <p className="muted">{contactAgent ? contactAgent.description : t("chat.teamHelp")}</p>
            </div>
          )}
          {detail?.turns.map((turn, i) => {
            const isLive = turn.runId === liveRunId;
            return (
              <div key={turn.runId} className="turn">
                <div className="bubble-row me">
                  <div className="bubble me">{turn.prompt}</div>
                </div>
                <div className="bubble-row them">
                  <Avatar agent={contactAgent} size={30} />
                  <div className="bubble them">
                    {isLive ? (
                      <LiveTurn run={live.run} onDecide={decide} />
                    ) : turn.answer ? (
                      <>
                        <Markdown text={turn.answer} />
                        <ResultsBar runId={turn.runId} prompt={turn.prompt} health={health} refreshKey={i} />
                      </>
                    ) : (
                      <div className="error small">{turn.error ?? t("chat.noAnswer")}</div>
                    )}
                    <div className="bubble-meta small muted">
                      {time(turn.startedAt)}
                      {turn.costUsd ? ` · ${usd(turn.costUsd)}` : ""} ·{" "}
                      <a href={`#/runs?run=${turn.runId}`}>{t("chat.details")}</a>
                    </div>
                    {!isLive && turn.answer && contactAgent && <Feedback compact runId={turn.runId} stepId="s1" agentId={contactAgent.id} name={nameOf(contactAgent)} />}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <footer className="chat-compose">
          {error && <div className="error small">{error}</div>}
          <div className="chat-input">
            <textarea
              id="chat-input"
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder={liveRunId ? t("chat.waiting") : t("chat.placeholder", { name: nameOf(contactAgent) })}
              disabled={health?.canStartRuns === false}
            />
            <button className="chat-send" onClick={send} disabled={!text.trim() || busy || Boolean(liveRunId)} aria-label={t("composer.send")}>
              ➤
            </button>
          </div>
          <div className="small muted">{t("chat.hint")}</div>
        </footer>
      </section>
    </div>
  );
}

// What the agent is doing right now, as a "typing" bubble; approvals appear inline.
function LiveTurn({ run, onDecide }: { run: RunView; onDecide: (approvalId: string, d: "approve" | "approve_run" | "reject") => void }) {
  const active = run.order.map((id) => run.steps[id]!).filter((s) => s && (s.status === "running" || s.status === "waiting_approval"));
  return (
    <div className="live-turn">
      {active.length === 0 ? (
        <span className="typing">
          <i />
          <i />
          <i />
        </span>
      ) : (
        active.map((s) => {
          const a = agentFor(run, s.agentId);
          return (
            <div key={s.id} className="live-line" style={{ color: a.color }}>
              <span className="typing">
                <i />
                <i />
                <i />
              </span>{" "}
              <strong>{a.name}</strong> <span className="muted">{toolLine(s.lastTool)}</span>
            </div>
          );
        })
      )}
      {run.pending
        .filter((p) => p.kind === "tool")
        .map((p) => {
          if (p.kind !== "tool") return null;
          const input = p.input as Record<string, unknown>;
          const what = typeof input?.command === "string" ? input.command : typeof input?.file_path === "string" ? shortPath(input.file_path) : JSON.stringify(input).slice(0, 120);
          return (
            <div key={p.approvalId} className="chat-approval">
              <div>
                ⏸ {t("approval.wants")} <strong>{p.tool}</strong>: <code>{what}</code>
              </div>
              <ApprovalButtons onDecide={(d) => onDecide(p.approvalId, d)} />
            </div>
          );
        })}
      {run.pending.some((p) => p.kind === "plan") && <div className="small muted">{t("chat.planWaiting")}</div>}
    </div>
  );
}
