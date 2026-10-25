import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type RunStarter } from "../src/app.ts";
import { RunStore } from "../src/store.ts";
import type { Config } from "../src/config.ts";

const config: Config = {
  authMode: "claude_cli_login", host: "127.0.0.1", port: 0, model: "m",
  runBudgetUsd: 0.5, maxTurns: 3, workspacesDir: "/tmp/claudestra-test",
};

function fakeRunner(store: RunStore): RunStarter {
  return {
    async start(runId) {
      store.append(runId, { type: "step.message", data: { messageId: "m1", text: "hi", partial: false, role: "assistant" } });
      store.append(runId, { type: "run.completed", data: { answer: "hi", totalCostUsd: 0, durationMs: 1, numTurns: 1 } });
    },
    cancel: () => false,
  };
}

async function readEvents(res: Response, count: number): Promise<{ id: string; data: { type: string; seq: number } }[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: { id: string; data: { type: string; seq: number } }[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const id = /^id: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (id && data) events.push({ id, data: JSON.parse(data) });
    }
  }
  await reader.cancel();
  return events;
}

test("POST /api/runs then SSE replays all events in order, and resumes after Last-Event-ID", async () => {
  const store = new RunStore();
  const app = createApp(config, store, fakeRunner(store));

  assert.equal((await app.request("/api/runs", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status, 400);

  const res = await app.request("/api/runs", { method: "POST", body: JSON.stringify({ prompt: "hello" }), headers: { "content-type": "application/json" } });
  assert.equal(res.status, 201);
  const { runId } = (await res.json()) as { runId: string };

  const all = await readEvents(await app.request(`/api/runs/${runId}/events`), 3);
  assert.deepEqual(all.map((e) => e.data.type), ["run.started", "step.message", "run.completed"]);

  const resumed = await readEvents(await app.request(`/api/runs/${runId}/events`, { headers: { "Last-Event-ID": "2" } }), 1);
  assert.deepEqual(resumed.map((e) => e.data.seq), [3]);
});

test("observer hooks create a run per Claude Code session", async () => {
  const store = new RunStore();
  const app = createApp({ ...config, authMode: "observer" }, store, fakeRunner(store));
  const post = (event: string, body: object) =>
    app.request(`/hooks/${event}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  await post("SessionStart", { session_id: "abc", cwd: "/proj" });
  await post("PreToolUse", { session_id: "abc", tool_name: "Read", tool_use_id: "t1", tool_input: {} });
  await post("PostToolUse", { session_id: "abc", tool_name: "Read", tool_use_id: "t1", tool_response: "ok" });

  const types = store.events("obs-abc").map((e) => e.type);
  assert.deepEqual(types, ["run.started", "step.started", "step.message", "tool.called", "tool.result"]);

  const health = (await (await app.request("/api/health")).json()) as { canStartRuns: boolean };
  assert.equal(health.canStartRuns, false);
  const blocked = await app.request("/api/runs", { method: "POST", body: JSON.stringify({ prompt: "x" }), headers: { "content-type": "application/json" } });
  assert.equal(blocked.status, 409);
});
