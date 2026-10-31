import { test } from "node:test";
import assert from "node:assert/strict";
import { QuotaGate, retryAfterMs, retryDecision } from "../src/quota.ts";
import { geminiRetryInfo } from "../src/gemini.ts";

test("quota gate: RPM pacing and a shared cool-down", async () => {
  let now = 0;
  const slept: number[] = [];
  const sleep = async (ms: number) => {
    slept.push(ms);
    now += ms;
  };
  const gate = new QuotaGate(30, () => now); // one request every 2 s
  const signal = new AbortController().signal;
  assert.equal(await gate.acquire(signal, sleep), true);
  assert.equal(await gate.acquire(signal, sleep), true);
  assert.deepEqual(slept, [2000]);
  gate.cooldown(10_000);
  await gate.acquire(signal, sleep);
  assert.equal(now, 12_000);
  const aborted = new AbortController();
  aborted.abort();
  gate.cooldown(5000);
  assert.equal(await gate.acquire(aborted.signal, sleep), false);
});

test("retry decision: waits on 429/503 within the budget, fails on daily quota and when the budget is spent", () => {
  const clock = () => new Date(2026, 0, 1, 10, 0, 0);
  const w = retryDecision({ engine: "Gemini", status: 503, attempt: 0, waitedMs: 0, maxWaitMs: 600_000, clock });
  assert.equal(w?.kind, "wait");
  assert.equal(w?.kind === "wait" && w.ms, 2000);
  assert.match(w!.message, /overloaded; waiting 2 s \(until 10:00:02\)/);
  const ra = retryDecision({ engine: "Meta", status: 429, attempt: 5, waitedMs: 0, maxWaitMs: 600_000, retryAfterMs: 30_000 });
  assert.equal(ra?.kind === "wait" && ra.ms, 30_000);
  assert.equal(retryDecision({ engine: "Gemini", status: 429, attempt: 0, waitedMs: 0, maxWaitMs: 600_000, daily: true })?.kind, "fail");
  assert.equal(retryDecision({ engine: "Gemini", status: 503, attempt: 3, waitedMs: 599_000, maxWaitMs: 600_000 })?.kind, "fail");
  assert.equal(retryDecision({ engine: "Gemini", status: 400, attempt: 0, waitedMs: 0, maxWaitMs: 600_000 }), null);
});

test("retry hints: Retry-After header and Gemini RetryInfo / per-day quota", () => {
  assert.equal(retryAfterMs("12"), 12_000);
  assert.equal(retryAfterMs(new Date(61_000).toUTCString(), 1000), 60_000);
  assert.equal(retryAfterMs(null), null);
  assert.deepEqual(geminiRetryInfo({ error: { details: [{ "@type": "RetryInfo", retryDelay: "37s" }] } }), { retryAfterMs: 37_500, daily: false });
  assert.equal(geminiRetryInfo({ error: { details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }).daily, true);
});
