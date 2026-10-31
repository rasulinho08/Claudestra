// Quota-aware waiting for the Gemini and OpenAI-compatible engines (upgrade E3). One gate per engine, shared by all
// steps of all runs in this process:
//   - optional pacing: at most RPM requests per minute (GEMINI_RPM / META_RPM / OPENAI_RPM);
//   - a shared cool-down: when one step hits 429/503, every step waits until the provider is ready again;
//   - a wait budget (QUOTA_MAX_WAIT_SEC, default 10 min) instead of failing after three quick retries;
//   - daily quotas fail at once with a clear message, because waiting hours helps nobody.

export class QuotaGate {
  private nextSlot = 0;
  private cooldownUntil = 0;
  constructor(public rpm = 0, private now: () => number = Date.now) {}

  // Earliest time the next request may start (does not reserve it).
  readyAt(): number {
    return Math.max(this.cooldownUntil, this.rpm > 0 ? this.nextSlot : 0);
  }

  // Waits for a request slot; resolves false if the signal aborts first.
  async acquire(signal: AbortSignal, sleep = abortableSleep): Promise<boolean> {
    for (;;) {
      if (signal.aborted) return false;
      const wait = this.readyAt() - this.now();
      if (wait <= 0) {
        if (this.rpm > 0) this.nextSlot = Math.max(this.now(), this.nextSlot) + 60_000 / this.rpm;
        return true;
      }
      await sleep(Math.min(wait, 60_000), signal);
    }
  }

  cooldown(ms: number) {
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + ms);
  }
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

const gates = new Map<string, QuotaGate>();

export function gateFor(engine: string, env: Record<string, string | undefined>): QuotaGate {
  const key = engine.toUpperCase().replace(/[^A-Z]/g, "_");
  const rpm = Number(env[`${key}_RPM`]) || 0;
  let gate = gates.get(key);
  if (!gate) gates.set(key, (gate = new QuotaGate(rpm)));
  gate.rpm = rpm;
  return gate;
}

export const maxWaitMs = (env: Record<string, string | undefined>) => {
  const sec = Number(env.QUOTA_MAX_WAIT_SEC);
  return (Number.isFinite(sec) && sec >= 0 && env.QUOTA_MAX_WAIT_SEC !== "" && env.QUOTA_MAX_WAIT_SEC !== undefined ? sec : 600) * 1000;
};

export type RetryDecision = { kind: "wait"; ms: number; message: string } | { kind: "fail"; message: string };

// What to do after a failed request. `attempt` counts retries of this request; `waited` is the time already spent.
export function retryDecision(o: {
  engine: string;
  status: number;
  attempt: number;
  waitedMs: number;
  maxWaitMs: number;
  retryAfterMs?: number | null;
  daily?: boolean;
  clock?: () => Date;
}): RetryDecision | null {
  const transient = o.status === 429 || o.status === 408 || o.status >= 500;
  if (!transient) return null;
  if (o.daily) return { kind: "fail", message: `${o.engine}: the quota is used up (daily limit or no credit left), so waiting will not help; try tomorrow, add credit, or switch engine.` };
  const backoff = Math.min(2000 * 2 ** o.attempt, 60_000);
  const ms = Math.max(1000, Math.min(o.retryAfterMs && o.retryAfterMs > 0 ? o.retryAfterMs : backoff, 5 * 60_000));
  if (o.waitedMs + ms > o.maxWaitMs) return { kind: "fail", message: `${o.engine} stayed busy or rate-limited for ${Math.round(o.waitedMs / 1000)} s (limit QUOTA_MAX_WAIT_SEC=${Math.round(o.maxWaitMs / 1000)}).` };
  const at = new Date((o.clock ?? (() => new Date()))().getTime() + ms);
  const hhmmss = at.toTimeString().slice(0, 8);
  const why = o.status === 429 ? "rate limit reached" : o.status === 503 ? "overloaded" : `error ${o.status}`;
  return { kind: "wait", ms, message: `${o.engine} ${why}; waiting ${Math.round(ms / 1000)} s (until ${hhmmss}) and continuing automatically…` };
}

// Retry-After header: seconds or an HTTP date.
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s)) return s * 1000;
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}
