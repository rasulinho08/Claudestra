// Automations (docs/20): recurring jobs that start on their own. One switch each; the schedule is chosen with a
// time and days instead of a cron line. Results appear in Runs and, with the Telegram bot on, in Telegram.
import { useCallback, useEffect, useState } from "react";
import type { HealthResponse } from "@claudestra/protocol";
import { api, errorText } from "../api.ts";
import { t, type Key } from "../i18n.ts";
import { ago, eta } from "./MissionsPage.tsx";

type Automation = {
  id: string; enabled: boolean; available: boolean; cron: string; params: { key: string; label: string; value: string }[];
  triggerId: string | null; nextRunAt: string | null; lastRunAt: string | null; lastRunId: string | null; lastError: string | null;
};

type Days = "daily" | "weekdays" | "1" | "2" | "3" | "4" | "5" | "6" | "0";
const ICONS: Record<string, string> = { "morning-brief": "🌅", "sprint-report": "📊", "market-watch": "📰", "weekly-social": "📣" };

// "30 8 * * 1-5" ↔ { time: "08:30", days: "weekdays" }. Anything else is kept as written.
export function readCron(cron: string): { time: string; days: Days } | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(cron.trim());
  if (!m) return null;
  return { time: `${m[2]!.padStart(2, "0")}:${m[1]!.padStart(2, "0")}`, days: m[3] === "*" ? "daily" : m[3] === "1-5" ? "weekdays" : (m[3] as Days) };
}
export function writeCron(time: string, days: Days): string {
  const [h = "9", m = "0"] = time.split(":");
  return `${Number(m)} ${Number(h)} * * ${days === "daily" ? "*" : days === "weekdays" ? "1-5" : days}`;
}

export function AutomationsPage({ health }: { health: HealthResponse | null }) {
  const [list, setList] = useState<Automation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Automation[]>("/api/automations").then(setList).catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="page-scroll">
      <div className="page-narrow auto-page">
        <header>
          <h2>{t("nav.automations")}</h2>
          <p className="muted">{t("auto.intro")}</p>
        </header>
        {error && <div className="error small">{error}</div>}
        {health?.canStartRuns === false && <div className="banner">{t("composer.disabled")}</div>}
        <div className="auto-grid">
          {list.map((a) => (
            <Card key={a.id} a={a} onChanged={load} onError={setError} />
          ))}
        </div>
        <p className="small muted">{t("auto.note")}</p>
      </div>
    </div>
  );
}

function Card({ a, onChanged, onError }: { a: Automation; onChanged: () => void; onError: (e: string | null) => void }) {
  const parsed = readCron(a.cron);
  const [time, setTime] = useState(parsed?.time ?? "09:00");
  const [days, setDays] = useState<Days>(parsed?.days ?? "daily");
  const [params, setParams] = useState<Record<string, string>>(Object.fromEntries(a.params.map((p) => [p.key, p.value])));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const title = t(`auto.${a.id}.title` as Key);
  const dirty = (parsed ? writeCron(time, days) !== a.cron : false) || a.params.some((p) => (params[p.key] ?? "") !== p.value);

  async function save(turnOn: boolean) {
    setBusy(true);
    onError(null);
    try {
      if (turnOn) await api(`/api/automations/${a.id}`, { body: { title, cron: parsed || !a.triggerId ? writeCron(time, days) : undefined, params } });
      else await api(`/api/automations/${a.id}`, { method: "DELETE" });
      setNote(turnOn ? t("agents.saved").split(".")[0]! : null);
      onChanged();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function runNow() {
    setBusy(true);
    onError(null);
    try {
      const r = await api<{ runId: string }>(`/api/automations/${a.id}/run`, { body: {} });
      window.location.hash = `#/runs?run=${r.runId}`;
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`auto-card ${a.enabled ? "on" : ""}`}>
      <div className="auto-head">
        <span className="auto-icon" aria-hidden="true">
          {ICONS[a.id] ?? "⚙"}
        </span>
        <div>
          <h3>{title}</h3>
          <p className="small muted">{t(`auto.${a.id}.desc` as Key)}</p>
        </div>
        <label className="switch" title={a.enabled ? t("auto.turnOff") : t("auto.turnOn")}>
          <input type="checkbox" checked={a.enabled} disabled={busy || !a.available} onChange={(e) => void save(e.target.checked)} aria-label={`${title}: ${a.enabled ? t("auto.turnOff") : t("auto.turnOn")}`} />
          <span />
        </label>
      </div>
      {!a.available && <div className="error small">{t("auto.unavailable")}</div>}

      <div className="office-options">
        <label className="field-inline">
          <span className="small muted">{t("auto.when")}</span>
          {parsed || !a.triggerId ? (
            <span className="row-gap">
              <select value={days} onChange={(e) => setDays(e.target.value as Days)}>
                <option value="daily">{t("auto.daily")}</option>
                <option value="weekdays">{t("auto.weekdays")}</option>
                {(["1", "2", "3", "4", "5", "6", "0"] as const).map((d) => (
                  <option key={d} value={d}>
                    {t(`auto.day${d}` as Key)}
                  </option>
                ))}
              </select>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t("auto.time")} />
            </span>
          ) : (
            <code>{a.cron}</code>
          )}
        </label>
      </div>
      {a.params.map((p) => (
        <label key={p.key} className="field">
          <span className="small muted">{t(`auto.field.${p.key}` as Key)}</span>
          <input value={params[p.key] ?? ""} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })} maxLength={2000} />
        </label>
      ))}

      <div className="auto-foot">
        <span className="small muted">
          {a.enabled && a.nextRunAt ? `${t("missions.next")} ${eta(a.nextRunAt)}` : t("auto.off")}
          {a.lastRunAt ? ` · ${t("auto.last")} ${ago(a.lastRunAt)}` : ""}
          {note && !dirty ? ` · ✓ ${note}` : ""}
        </span>
        <span className="row-gap">
          {a.lastRunId && (
            <a className="ghost" href={`#/runs?run=${a.lastRunId}`}>
              {t("auto.lastResult")}
            </a>
          )}
          {a.enabled && (
            <button className="ghost" onClick={() => void runNow()} disabled={busy}>
              ⏩ {t("auto.runNow")}
            </button>
          )}
          {(dirty || !a.enabled) && a.available && (
            <button className="hq-new" onClick={() => void save(true)} disabled={busy}>
              {a.enabled ? t("skills.save") : t("auto.turnOn")}
            </button>
          )}
        </span>
      </div>
      {a.lastError && <div className="error small">{a.lastError}</div>}
    </section>
  );
}
