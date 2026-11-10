// Telegram bot (docs/18): run the company from a phone. Write a task, start a mission, see the status, and approve or
// reject what agents ask for, with buttons. Uses long polling, so it works on a home PC without a public address.
// Only chats listed in TELEGRAM_ALLOWED_CHATS may use it; they act as the owner, so keep the list short.
import type { RunStore } from "./store.ts";
import type { RunRequest } from "./runs.ts";
import { MissionInput, type MissionRunner, type Missions } from "./missions.ts";

type Fetch = typeof fetch;
type Decide = (runId: string, approvalId: string, decision: "approve" | "reject", note: string) => boolean;

export type TelegramDeps = {
  token: string;
  allowedChats: string[];
  store: RunStore;
  start: (req: RunRequest) => { runId: string };
  decide: Decide;
  cancel: (runId: string) => boolean;
  missions: Missions;
  missionRunner: MissionRunner;
  // Shown in messages so the person can open the full result (PUBLIC_URL, or the local address).
  appUrl: string;
  lang?: BotLang;
  fetch?: Fetch;
  apiBase?: string;
};

type Update = {
  update_id: number;
  message?: { chat: { id: number }; text?: string; voice?: unknown; from?: { first_name?: string } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
};
type PendingApproval = { id: string; run_id: string; kind: string; request: string; prompt: string; agent_id: string | null };

const MAX_TEXT = 3500;
const clip = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}\n…` : s);

const TEXT = {
  en: {
    help: [
      "Claudestra",
      "",
      "Write any task and the team starts working. When it is done, the answer comes here.",
      "",
      "/mission 7 <goal>  work on a goal in the background for 7 days (1–60)",
      "/status  what is running, missions, what waits for you",
      "/missions  list missions",
      "/pause <n>, /resume <n>, /stop <n>  control mission number n from /missions",
      "/cancel  stop the task that is running now",
      "/id  show this chat's id",
    ].join("\n"),
    notPaired: "This chat is not connected yet.\nChat id: {id}\nThe owner adds it to TELEGRAM_ALLOWED_CHATS in .env and restarts Claudestra.",
    voice: "Voice messages are not understood yet. Use the keyboard's microphone to dictate text, or type the task.",
    unknown: "Unknown command {cmd}.",
    started: "▶ Started. I will write when it is done.",
    missionHow: "Write it like this:\n/mission 7 Research the GRC market and keep a weekly report up to date",
    missionStarted: "🚀 Mission started for {days} day(s), a work session every 2 hours.",
    noMissions: "No missions are running. Start one with /mission 7 <goal>.",
    workingNow: "working now",
    sessions: "session(s)",
    which: "Which one? Give the number from /missions, for example /{action} 1",
    paused: "⏸ Paused",
    resumed: "▶ Resumed",
    stopped: "■ Stopped",
    nothingRunning: "Nothing started from this chat is running.",
    cancelled: "■ Cancelled {n} task(s).",
    running: "⚙ Running",
    missions: "🚀 Missions",
    waiting: "⏸ Waiting for you",
    gone: "This request is no longer waiting.",
    approved: "✓ Approved",
    rejected: "✕ Rejected",
    done: "✅ Done",
    runCancelled: "■ Cancelled",
    failed: "⚠ Failed",
    needs: "⏸ {who} needs your approval:",
    plan: "a plan to approve",
    task: "Task",
    approve: "✓ Approve",
    reject: "✕ Reject",
    missionDone: "🎉 Mission finished",
    missionFailed: "⚠ Mission needs attention",
    missionStopped: "■ Mission stopped",
  },
  az: {
    help: [
      "Claudestra",
      "",
      "İstənilən tapşırığı yazın, komanda işə başlayır. Bitəndə cavab bura gəlir.",
      "",
      "/mission 7 <məqsəd>  məqsəd üzərində 7 gün arxa planda işləmək (1–60)",
      "/status  nə işləyir, missiyalar, sizi nə gözləyir",
      "/missions  missiyaların siyahısı",
      "/pause <n>, /resume <n>, /stop <n>  /missions siyahısındakı n nömrəli missiyanı idarə etmək",
      "/cancel  indi gedən tapşırığı dayandırmaq",
      "/id  bu söhbətin id-si",
    ].join("\n"),
    notPaired: "Bu söhbət hələ qoşulmayıb.\nChat id: {id}\nSahib onu .env faylında TELEGRAM_ALLOWED_CHATS-ə əlavə edib Claudestra-nı yenidən başlatmalıdır.",
    voice: "Səsli mesajları hələ başa düşmürəm. Klaviaturadakı mikrofonla diktə edin və ya tapşırığı yazın.",
    unknown: "Naməlum əmr: {cmd}.",
    started: "▶ Başladı. Bitəndə yazacağam.",
    missionHow: "Belə yazın:\n/mission 7 GRC bazarını araşdır və həftəlik hesabatı yenilə",
    missionStarted: "🚀 Missiya {days} günlük başladı, hər 2 saatdan bir iş seansı.",
    noMissions: "Aktiv missiya yoxdur. Başlamaq üçün: /mission 7 <məqsəd>.",
    workingNow: "indi işləyir",
    sessions: "seans",
    which: "Hansı? /missions siyahısındakı nömrəni yazın, məsələn /{action} 1",
    paused: "⏸ Fasilə verildi",
    resumed: "▶ Davam edir",
    stopped: "■ Dayandırıldı",
    nothingRunning: "Bu söhbətdən başladılan işləyən tapşırıq yoxdur.",
    cancelled: "■ {n} tapşırıq ləğv edildi.",
    running: "⚙ İşləyir",
    missions: "🚀 Missiyalar",
    waiting: "⏸ Sizi gözləyir",
    gone: "Bu sorğu artıq gözləmir.",
    approved: "✓ Təsdiqləndi",
    rejected: "✕ Rədd edildi",
    done: "✅ Hazırdır",
    runCancelled: "■ Ləğv edildi",
    failed: "⚠ Alınmadı",
    needs: "⏸ {who} sizin təsdiqinizi gözləyir:",
    plan: "təsdiqlənəcək plan",
    task: "Tapşırıq",
    approve: "✓ Təsdiqlə",
    reject: "✕ Rədd et",
    missionDone: "🎉 Missiya bitdi",
    missionFailed: "⚠ Missiyaya diqqət lazımdır",
    missionStopped: "■ Missiya dayandı",
  },
};
export type BotLang = keyof typeof TEXT;
const fill = (s: string, vars: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
export const HELP = TEXT.en.help;

export class TelegramBot {
  private offset = 0;
  private stopped = false;
  private fetch: Fetch;
  private base: string;
  // Runs started from a chat, so the answer goes back to it; approvals already announced.
  private watching = new Map<string, string>();
  private announced = new Set<string>();
  private missionStatus = new Map<string, string>();
  // Scheduled runs (automations and other triggers) already reported.
  private reported = new Set<string>();
  private primed = false;

  private t: (typeof TEXT)["en"];

  constructor(private deps: TelegramDeps) {
    this.t = TEXT[deps.lang ?? "en"];
    this.fetch = deps.fetch ?? fetch;
    this.base = `${deps.apiBase ?? "https://api.telegram.org"}/bot${deps.token}`;
  }

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 40_000): Promise<T | null> {
    try {
      const res = await this.fetch(`${this.base}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const json = (await res.json()) as { ok: boolean; result?: T };
      return json.ok ? (json.result ?? null) : null;
    } catch {
      return null;
    }
  }

  send(chat: string, text: string, buttons?: { text: string; data: string }[]) {
    return this.call("sendMessage", {
      chat_id: chat,
      text: clip(text),
      disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] } } : {}),
    });
  }

  private allowed(chat: string) {
    return this.deps.allowedChats.includes(chat);
  }

  // ---- incoming ------------------------------------------------------------------------------

  async handle(update: Update): Promise<void> {
    if (update.callback_query) return this.onButton(update.callback_query);
    const msg = update.message;
    if (!msg) return;
    const chat = String(msg.chat.id);
    const text = (msg.text ?? "").trim();
    if (text === "/id" || !this.allowed(chat)) {
      // Not paired: say how, and nothing else (no task is started for strangers).
      await this.send(chat, this.allowed(chat) ? `Chat id: ${chat}` : fill(this.t.notPaired, { id: chat }));
      return;
    }
    if (msg.voice && !text) {
      await this.send(chat, this.t.voice);
      return;
    }
    if (!text) return;
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ");
    try {
      switch (cmd!.toLowerCase().replace(/@.*$/, "")) {
        case "/start":
        case "/help":
          return void (await this.send(chat, this.t.help));
        case "/status":
          return void (await this.send(chat, this.status()));
        case "/missions":
          return void (await this.send(chat, this.missionList()));
        case "/mission":
          return void (await this.startMission(chat, rest));
        case "/pause":
        case "/resume":
        case "/stop":
          return void (await this.missionAction(chat, cmd!.slice(1).toLowerCase() as "pause" | "resume" | "stop", arg));
        case "/cancel":
          return void (await this.cancelRunning(chat));
        default:
          if (cmd!.startsWith("/")) return void (await this.send(chat, `${fill(this.t.unknown, { cmd: cmd! })}\n\n${this.t.help}`));
          return void (await this.startRun(chat, text));
      }
    } catch (err) {
      await this.send(chat, `⚠ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async startRun(chat: string, prompt: string) {
    const { runId } = this.deps.start({ prompt, origin: `telegram:${chat}`, createdBy: "telegram" });
    this.watching.set(runId, chat);
    await this.send(chat, `${this.t.started}\n${this.deps.appUrl}/#/runs?run=${runId}`);
  }

  private async startMission(chat: string, words: string[]) {
    const days = Number(words[0]);
    const hasDays = Number.isFinite(days) && days > 0;
    const goal = (hasDays ? words.slice(1) : words).join(" ").trim();
    if (goal.length < 3) return void (await this.send(chat, this.t.missionHow));
    const input = MissionInput.parse({ goal, days: hasDays ? Math.min(60, days) : 7, intervalMinutes: 120 });
    const m = this.deps.missions.create(input, "telegram");
    this.deps.missionRunner.tick();
    await this.send(chat, `${fill(this.t.missionStarted, { days: input.days })}\n${this.deps.appUrl}/#/missions?id=${m.id}`);
  }

  private missionsNow() {
    return this.deps.missions.list().filter((m) => m.status === "active" || m.status === "paused");
  }

  private missionList(): string {
    const list = this.missionsNow();
    if (list.length === 0) return this.t.noMissions;
    return list.map((m, i) => `${i + 1}. ${m.title}\n   ${m.currentRunId ? this.t.workingNow : m.status} · ${m.ticks} ${this.t.sessions} · $${m.spentUsd.toFixed(2)}`).join("\n");
  }

  private async missionAction(chat: string, action: "pause" | "resume" | "stop", arg: string) {
    const m = this.missionsNow()[Number(arg) - 1];
    if (!m) return void (await this.send(chat, fill(this.t.which, { action })));
    if (action === "pause") this.deps.missions.set(m.id, { status: "paused" });
    if (action === "resume") {
      this.deps.missions.set(m.id, { status: "active", failures: 0, last_error: null, next_tick_at: new Date().toISOString() });
      this.deps.missionRunner.tick();
    }
    if (action === "stop") {
      if (m.currentRunId && this.deps.store.status(m.currentRunId) === "running") this.deps.cancel(m.currentRunId);
      this.deps.missions.set(m.id, { status: "stopped", next_tick_at: null });
    }
    await this.send(chat, `${action === "pause" ? this.t.paused : action === "resume" ? this.t.resumed : this.t.stopped}: ${m.title}`);
  }

  private async cancelRunning(chat: string) {
    const mine = [...this.watching.entries()].filter(([runId, c]) => c === chat && this.deps.store.status(runId) === "running");
    if (mine.length === 0) return void (await this.send(chat, this.t.nothingRunning));
    for (const [runId] of mine) this.deps.cancel(runId);
    await this.send(chat, fill(this.t.cancelled, { n: mine.length }));
  }

  private pending(): PendingApproval[] {
    return this.deps.store.database
      .prepare("SELECT a.id, a.run_id, a.kind, a.request, r.prompt, s.agent_id FROM approvals a JOIN runs r ON r.id = a.run_id LEFT JOIN steps s ON s.run_id = a.run_id AND s.step_id = a.step_id WHERE a.decision IS NULL AND r.status = 'running' ORDER BY a.created_at")
      .all() as PendingApproval[];
  }

  private status(): string {
    const running = this.deps.store.list(100).filter((r) => r.status === "running");
    const lines = [`${this.t.running}: ${running.length}`];
    for (const r of running.slice(0, 5)) lines.push(`  • ${r.prompt.slice(0, 70)}`);
    const missions = this.missionsNow();
    lines.push(`${this.t.missions}: ${missions.length}`);
    for (const m of missions.slice(0, 5)) lines.push(`  • ${m.title.slice(0, 60)} (${m.currentRunId ? this.t.workingNow : m.status}, ${m.ticks} ${this.t.sessions})`);
    lines.push(`${this.t.waiting}: ${this.pending().length}`);
    return lines.join("\n");
  }

  private async onButton(q: NonNullable<Update["callback_query"]>) {
    const chat = String(q.message?.chat.id ?? "");
    const m = /^(ok|no):([A-Za-z0-9-]{1,80})$/.exec(q.data ?? "");
    if (!this.allowed(chat) || !m) return void (await this.call("answerCallbackQuery", { callback_query_id: q.id }));
    const approval = this.deps.store.database.prepare("SELECT run_id, decision FROM approvals WHERE id = ?").get(m[2]!) as { run_id: string; decision: string | null } | undefined;
    let note: string = this.t.gone;
    if (approval && approval.decision === null) {
      const done = this.deps.decide(approval.run_id, m[2]!, m[1] === "ok" ? "approve" : "reject", m[1] === "ok" ? "" : "Rejected from Telegram");
      note = done ? (m[1] === "ok" ? this.t.approved : this.t.rejected) : note;
    }
    await this.call("answerCallbackQuery", { callback_query_id: q.id, text: note });
    if (q.message) await this.call("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    await this.send(chat, note);
  }

  // ---- outgoing: answers, approvals, mission news ---------------------------------------------

  async notify(): Promise<void> {
    const { store } = this.deps;
    for (const [runId, chat] of [...this.watching.entries()]) {
      const status = store.status(runId);
      if (status === "running") continue;
      this.watching.delete(runId);
      const events = store.events(runId);
      const completed = events.find((e) => e.type === "run.completed");
      const failed = events.find((e) => e.type === "run.failed");
      const link = `${this.deps.appUrl}/#/runs?run=${runId}`;
      if (completed) await this.send(chat, `${this.t.done}\n\n${clip((completed.data as { answer: string }).answer, 3000)}\n\n${link}`);
      else await this.send(chat, `${status === "cancelled" ? this.t.runCancelled : `${this.t.failed}: ${failed ? (failed.data as { error: string }).error.slice(0, 300) : ""}`}\n${link}`);
    }
    // Scheduled work (automations, docs/20): its result goes to every allowed chat.
    for (const r of store.list(60)) {
      if (!(r.origin ?? "").startsWith("trigger:") || r.status === "running" || this.reported.has(r.id)) continue;
      this.reported.add(r.id);
      if (!this.primed) continue;
      const done = store.events(r.id).find((e) => e.type === "run.completed");
      const link = `${this.deps.appUrl}/#/runs?run=${r.id}`;
      const title = `🗓 ${r.createdBy ?? r.prompt.slice(0, 60)}`;
      for (const chat of this.deps.allowedChats) await this.send(chat, done ? `${title}\n\n${clip((done.data as { answer: string }).answer, 3000)}\n\n${link}` : `${title}\n${this.t.failed}\n${link}`);
    }
    // Approvals: every allowed chat is an owner, so each one gets the buttons.
    const pending = this.pending();
    for (const a of pending) {
      if (this.announced.has(a.id)) continue;
      this.announced.add(a.id);
      if (!this.primed) continue; // do not replay approvals that were already waiting at start-up
      let what: string = this.t.plan;
      try {
        const req = JSON.parse(a.request) as { tool?: string; input?: Record<string, unknown>; reason?: string };
        const input = req.input ?? {};
        const target = input.command ?? input.file_path ?? input.url ?? "";
        if (a.kind !== "plan") what = `${req.tool ?? "a tool"}${typeof target === "string" && target ? `\n${target.slice(0, 300)}` : ""}${req.reason ? `\n(${req.reason})` : ""}`;
      } catch {
        // keep the generic text
      }
      const text = `${fill(this.t.needs, { who: a.agent_id ?? "CEO" })}\n${what}\n\n${this.t.task}: ${a.prompt.slice(0, 120)}`;
      for (const chat of this.deps.allowedChats) {
        if (a.kind === "plan") await this.send(chat, `${text}\n${this.deps.appUrl}/#/runs?run=${a.run_id}`);
        else await this.send(chat, text, [{ text: this.t.approve, data: `ok:${a.id}` }, { text: this.t.reject, data: `no:${a.id}` }]);
      }
    }
    for (const m of this.deps.missions.list()) {
      const was = this.missionStatus.get(m.id);
      this.missionStatus.set(m.id, m.status);
      if (!this.primed || !was || was === m.status) continue;
      const news = m.status === "done" ? this.t.missionDone : m.status === "failed" ? this.t.missionFailed : m.status === "stopped" ? this.t.missionStopped : null;
      if (news) for (const chat of this.deps.allowedChats) await this.send(chat, `${news}: ${m.title}\n${m.lastError ?? ""}\n${this.deps.appUrl}/#/missions?id=${m.id}`.trim());
    }
    this.primed = true;
  }

  // ---- loop ----------------------------------------------------------------------------------

  async poll(timeoutSec = 25): Promise<number> {
    const updates = await this.call<Update[]>("getUpdates", { offset: this.offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] }, (timeoutSec + 10) * 1000);
    for (const u of updates ?? []) {
      this.offset = Math.max(this.offset, u.update_id + 1);
      await this.handle(u).catch(() => {});
    }
    return updates?.length ?? -1;
  }

  start() {
    const loop = async () => {
      while (!this.stopped) {
        const n = await this.poll();
        // A failed request (no network, wrong token) must not spin.
        if (n < 0) await new Promise((r) => setTimeout(r, 5000));
      }
    };
    void loop();
    const timer = setInterval(() => void this.notify().catch(() => {}), 4000);
    timer.unref?.();
    void this.call("setMyCommands", { commands: [{ command: "status", description: "What is running" }, { command: "mission", description: "Start a mission: /mission 7 goal" }, { command: "missions", description: "List missions" }, { command: "cancel", description: "Stop the running task" }, { command: "help", description: "How to use" }] });
    return () => {
      this.stopped = true;
      clearInterval(timer);
    };
  }
}
