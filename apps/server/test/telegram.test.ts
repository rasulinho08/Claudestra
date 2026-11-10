// Telegram bot (docs/18): only allowed chats, tasks and missions from messages, approvals with buttons.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RunStore } from "../src/store.ts";
import { MissionRunner, Missions } from "../src/missions.ts";
import { TelegramBot } from "../src/telegram.ts";
import type { RunRequest } from "../src/runs.ts";
import { SERVER_ONLY_SECRETS } from "../src/secret-env.ts";

function setup() {
  const store = new RunStore();
  const missions = new Missions(store);
  const started: RunRequest[] = [];
  const decided: string[] = [];
  const cancelled: string[] = [];
  const start = (req: RunRequest) => {
    const runId = `run-${started.length + 1}`;
    store.create({ id: runId, prompt: req.prompt, source: "claudestra", origin: req.origin });
    store.append(runId, { type: "run.started", data: { prompt: req.prompt, source: "claudestra", authMode: "demo", budgetUsd: 1, agents: [] } } as never);
    started.push(req);
    return { runId };
  };
  const missionRunner = new MissionRunner({ missions, store, workspacesDir: "/tmp/none", start });
  const sent: { method: string; body: Record<string, any> }[] = [];
  const fakeFetch = (async (url: string, init: { body: string }) => {
    sent.push({ method: String(url).split("/").pop()!, body: JSON.parse(init.body) });
    return { json: async () => ({ ok: true, result: [] }) };
  }) as unknown as typeof fetch;
  const bot = new TelegramBot({
    token: "T", allowedChats: ["100"], store, start, missions, missionRunner, appUrl: "http://app", fetch: fakeFetch,
    decide: (runId, approvalId, decision) => (decided.push(`${runId}:${approvalId}:${decision}`), true),
    cancel: (runId) => (cancelled.push(runId), true),
  });
  const say = (chat: number, text: string) => bot.handle({ update_id: 1, message: { chat: { id: chat }, text } });
  const texts = () => sent.filter((s) => s.method === "sendMessage").map((s) => String(s.body.text));
  return { store, missions, bot, started, decided, cancelled, sent, say, texts };
}

test("strangers get the chat id and nothing starts", async () => {
  const { say, started, texts, missions } = setup();
  await say(999, "delete everything");
  await say(999, "/mission 7 do things");
  assert.equal(started.length, 0);
  assert.equal(missions.list().length, 0);
  assert.match(texts()[0]!, /not connected yet[\s\S]*999/);
});

test("a message starts a task and the answer comes back", async () => {
  const { say, started, store, bot, texts } = setup();
  await say(100, "Write a short GRC report");
  assert.equal(started[0]!.prompt, "Write a short GRC report");
  assert.equal(started[0]!.origin, "telegram:100");
  assert.match(texts()[0]!, /Started[\s\S]*http:\/\/app\/#\/runs\?run=run-1/);
  await bot.notify();
  assert.equal(texts().length, 1, "nothing while it runs");
  store.append("run-1", { type: "run.completed", data: { answer: "The report is in report.md", totalCostUsd: 0.1, durationMs: 1, numTurns: 1 } });
  await bot.notify();
  assert.match(texts()[1]!, /Done[\s\S]*The report is in report\.md/);
  await bot.notify();
  assert.equal(texts().length, 2, "answered once");
});

test("missions: start, list, pause and stop from the chat", async () => {
  const { say, missions, texts, started } = setup();
  await say(100, "/mission 3 Research the market every day");
  const m = missions.list()[0]!;
  assert.equal(m.goal, "Research the market every day");
  assert.equal(Math.round((Date.parse(m.endsAt) - Date.parse(m.createdAt)) / 86_400_000), 3);
  assert.equal(started.length, 1, "first work session starts at once");
  await say(100, "/missions");
  assert.match(texts().at(-1)!, /1\. Research the market every day/);
  await say(100, "/pause 1");
  assert.equal(missions.get(m.id)!.status, "paused");
  await say(100, "/stop 1");
  assert.equal(missions.get(m.id)!.status, "stopped");
  await say(100, "/mission");
  assert.match(texts().at(-1)!, /Write it like this/);
});

test("approvals arrive with buttons and can be decided; old buttons do nothing", async () => {
  const { say, store, bot, sent, decided } = setup();
  await bot.notify(); // start-up: nothing waiting
  await say(100, "Build a site");
  store.recordApproval({ id: "ap-1", runId: "run-1", stepId: null, kind: "tool", request: { tool: "Bash", input: { command: "npm install" }, reason: "outside the safe list" } });
  await bot.notify();
  const ask = sent.filter((s) => s.method === "sendMessage").at(-1)!;
  assert.match(ask.body.text, /needs your approval[\s\S]*Bash[\s\S]*npm install/);
  assert.deepEqual(ask.body.reply_markup.inline_keyboard[0].map((b: { callback_data: string }) => b.callback_data), ["ok:ap-1", "no:ap-1"]);
  await bot.notify();
  assert.equal(sent.filter((s) => s.method === "sendMessage" && /needs your approval/.test(s.body.text)).length, 1, "asked once");

  await bot.handle({ update_id: 2, callback_query: { id: "q1", data: "ok:ap-1", message: { chat: { id: 999 }, message_id: 5 } } });
  assert.deepEqual(decided, [], "a stranger's button press is ignored");
  await bot.handle({ update_id: 3, callback_query: { id: "q2", data: "ok:ap-1", message: { chat: { id: 100 }, message_id: 5 } } });
  assert.deepEqual(decided, ["run-1:ap-1:approve"]);
  store.decideApproval("ap-1", "approve", "telegram", "");
  await bot.handle({ update_id: 4, callback_query: { id: "q3", data: "no:ap-1", message: { chat: { id: 100 }, message_id: 5 } } });
  assert.equal(decided.length, 1, "already decided");
});

test("status and cancel; the bot token never reaches agents", async () => {
  const { say, texts, cancelled } = setup();
  await say(100, "Long task");
  await say(100, "/status");
  assert.match(texts().at(-1)!, /Running: 1[\s\S]*Long task/);
  await say(100, "/cancel");
  assert.deepEqual(cancelled, ["run-1"]);
  assert.ok(SERVER_ONLY_SECRETS.includes("TELEGRAM_BOT_TOKEN"));
});
