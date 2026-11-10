// Browser notifications (docs/17): long work runs in the background, so tell the person when something needs them
// (an approval) or a mission ends, even when the tab is hidden. Opt-in: nothing is asked until they press the bell.
import { useEffect, useRef } from "react";
import { api } from "./api.ts";
import { t } from "./i18n.ts";

const KEY = "claudestra.notify";
export const notifySupported = () => typeof window !== "undefined" && "Notification" in window;
export const notifyOn = () => notifySupported() && Notification.permission === "granted" && localStorage.getItem(KEY) === "1";

export async function toggleNotify(): Promise<boolean> {
  if (!notifySupported()) return false;
  if (notifyOn()) {
    localStorage.setItem(KEY, "0");
    return false;
  }
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  localStorage.setItem(KEY, permission === "granted" ? "1" : "0");
  return permission === "granted";
}

type Watch = { approvals: { approvalId: string; runId: string; prompt: string; tool: string | null }[]; missions: { id: string; title: string; status: string }[] };

// What changed between two polls: new approvals, and missions that just finished or need attention.
export function changes(prev: Watch | null, next: Watch): { title: string; body: string; href: string }[] {
  if (!prev) return [];
  const out: { title: string; body: string; href: string }[] = [];
  const seen = new Set(prev.approvals.map((a) => a.approvalId));
  for (const a of next.approvals) if (!seen.has(a.approvalId)) out.push({ title: t("notify.approval"), body: `${a.tool ?? ""} · ${a.prompt}`.slice(0, 140), href: `#/runs?run=${a.runId}` });
  const before = new Map(prev.missions.map((m) => [m.id, m.status]));
  for (const m of next.missions) {
    const was = before.get(m.id);
    if (!was || was === m.status) continue;
    if (m.status === "done") out.push({ title: t("notify.missionDone"), body: m.title, href: `#/missions?id=${m.id}` });
    if (m.status === "failed") out.push({ title: t("notify.missionFailed"), body: m.title, href: `#/missions?id=${m.id}` });
  }
  return out;
}

// Polls quietly on every page; also shows the number of waiting approvals in the tab title.
export function useNotifier(enabled: boolean, onCount: (approvals: number) => void) {
  const prev = useRef<Watch | null>(null);
  const cb = useRef(onCount);
  cb.current = onCount;
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      try {
        const [hq, missions] = await Promise.all([api<{ approvals: Watch["approvals"] }>("/api/hq"), api<Watch["missions"]>("/api/missions")]);
        if (stop) return;
        const next = { approvals: hq.approvals, missions };
        cb.current(next.approvals.length);
        document.title = next.approvals.length > 0 ? `(${next.approvals.length}) Claudestra` : "Claudestra";
        if (notifyOn()) {
          for (const c of changes(prev.current, next)) {
            const n = new Notification(c.title, { body: c.body, tag: c.href });
            n.onclick = () => {
              window.focus();
              window.location.hash = c.href;
              n.close();
            };
          }
        }
        prev.current = next;
      } catch {
        // offline or logged out: try again next time
      }
    };
    void tick();
    const timer = window.setInterval(tick, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
}
