import { test } from "node:test";
import assert from "node:assert/strict";
import { DICTIONARIES, agentName, t } from "../src/i18n.ts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("i18n: every language has every key with the same placeholders", () => {
  const en = DICTIONARIES.en;
  for (const [lang, dict] of Object.entries(DICTIONARIES)) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), `${lang} keys`);
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      assert.ok(dict[key].trim(), `${lang}.${key} is empty`);
      assert.deepEqual(placeholders(dict[key]), placeholders(en[key]), `${lang}.${key} placeholders`);
    }
  }
});

test("i18n: t() fills placeholders; custom agents keep their own name", () => {
  assert.equal(t("top.agents", { n: 3 }), "3 agents");
  assert.equal(agentName("coder", "Coder"), "Coder");
  assert.equal(agentName("my-custom", "Bob"), "Bob");
  assert.ok(DICTIONARIES.az["agent.coder"] === "Proqramçı");
});
