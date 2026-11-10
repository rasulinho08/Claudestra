// Automations (docs/20): presets become a workflow plus a schedule; context values are filled in.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RunStore } from "../src/store.ts";
import { WorkflowStore } from "../src/workflows.ts";
import { TriggerStore } from "../src/triggers.ts";
import { Automations, PRESETS, contextParams } from "../src/automations.ts";
import { parseCron } from "../src/cron.ts";

const templatesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../templates");
const AGENTS = new Set(["project-manager", "researcher", "community-manager", "content-maker"]);

function setup(agents = AGENTS) {
  const store = new RunStore();
  const workflows = new WorkflowStore(store);
  const triggers = new TriggerStore(store);
  return { store, workflows, triggers, auto: new Automations(workflows, triggers, templatesDir, (id) => agents.has(id)) };
}

test("every preset has a template, a valid schedule and fields that exist", () => {
  const { auto } = setup();
  const list = auto.list();
  assert.deepEqual(list.map((a) => a.id), PRESETS.map((p) => p.id));
  for (const p of PRESETS) {
    parseCron(p.cron);
    const view = list.find((a) => a.id === p.id)!;
    assert.equal(view.enabled, false);
    assert.equal(view.available, true);
    assert.deepEqual(view.params.map((x) => x.key), p.fields, p.id);
  }
});

test("turning an automation on creates one workflow and one schedule; changes update them", () => {
  const { auto, workflows, triggers } = setup();
  const on = auto.enable("market-watch", { params: { topics: "GRC, AI proxy" } }, "Bazar izləmə");
  assert.equal(on.enabled, true);
  assert.equal(on.cron, "0 9 * * *");
  assert.ok(on.nextRunAt);
  assert.equal(on.params.find((p) => p.key === "topics")!.value, "GRC, AI proxy");
  assert.equal(workflows.list().length, 1);
  assert.equal(triggers.list()[0]!.name, "Bazar izləmə");

  const changed = auto.enable("market-watch", { cron: "30 7 * * 1-5", params: { days: "3" } }, "Bazar izləmə");
  assert.equal(changed.cron, "30 7 * * 1-5");
  assert.equal(changed.params.find((p) => p.key === "topics")!.value, "GRC, AI proxy", "earlier settings stay");
  assert.equal(changed.params.find((p) => p.key === "days")!.value, "3");
  assert.equal(workflows.list().length, 1, "no duplicate workflow");
  assert.equal(triggers.list().length, 1);

  assert.equal(auto.disable("market-watch"), true);
  assert.equal(auto.list().find((a) => a.id === "market-watch")!.enabled, false);
  assert.throws(() => auto.enable("market-watch", { cron: "every day", params: {} }, "x"), /cron/);
  assert.throws(() => auto.enable("nope", { params: {} }, "x"), /not found/);
});

test("an automation that needs input or a missing agent says so", () => {
  const { auto } = setup();
  assert.throws(() => auto.enable("weekly-social", { params: {} }, "Sosial"), /fill in/);
  assert.equal(auto.enable("weekly-social", { params: { prompt: "Acme GRC platform" } }, "Sosial").enabled, true);
  const few = setup(new Set(["researcher"]));
  assert.equal(few.auto.list().find((a) => a.id === "morning-brief")!.available, false);
  assert.throws(() => few.auto.enable("morning-brief", { params: {} }, "x"), /needs the agent "project-manager"/);
});

test("scheduled workflows get today's date and a summary of recent work", () => {
  const { store, workflows } = setup();
  store.create({ id: "r1", prompt: "Write the GRC report", source: "claudestra", origin: "user" });
  store.append("r1", { type: "run.completed", data: { answer: "ok", totalCostUsd: 0.4, durationMs: 1, numTurns: 1 } });
  store.create({ id: "r2", prompt: "scheduled thing", source: "claudestra", origin: "trigger:t1" });
  assert.equal(contextParams(store, new Date(2026, 10, 12, 8, 30)).today, "2026-11-12");
  const ctx: Record<string, string> = { ...contextParams(store), today: "2026-11-12" };
  assert.match(ctx.recent_work!, /1 task\(s\) in the last 24 hours/);
  assert.match(ctx.recent_work!, /\[completed\] Write the GRC report/);
  assert.doesNotMatch(ctx.recent_work!, /scheduled thing/, "its own scheduled runs are not news");

  const tpl = WorkflowStore.templates(templatesDir).find((t) => t.id === "morning-brief")!;
  const { id: _id, ...input } = tpl;
  const wf = workflows.create(input);
  const { prompt, plan } = workflows.instantiate(wf, { ...ctx, prompt: "" });
  assert.equal(prompt, "Morning briefing for 2026-11-12");
  assert.match(plan.steps[0]!.task, /brief\/2026-11-12\.md[\s\S]*|Write the GRC report/);
  assert.match(plan.steps[0]!.task, /Write the GRC report/);
});
