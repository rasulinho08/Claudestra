// Stage layout and choreography, kept free of drawing code so it can be unit tested.
// The world is a fixed 1280×720 box; the canvas scales it to fit.
import { CEO_FINAL_STEP, CEO_PLAN_STEP } from "@claudestra/protocol";
import type { RunView, StepView } from "../run-state.ts";
import { t, type Key } from "../i18n.ts";

export const WORLD_W = 1280;
export const WORLD_H = 720;
// Height of the world for a canvas of the given aspect: the world always fills the canvas.
export const worldHeightFor = (width: number, height: number) => Math.round(Math.max(560, Math.min(1500, (WORLD_W * height) / Math.max(1, width))) / 40) * 40;
export const HQ = "hq";
export const FINISH = "finish";

export type Pt = { x: number; y: number };

export type Station = {
  key: string;
  label: string;
  color: string;
  icon: string;
  agentId: string;
  pos: Pt;
  dist: number;
};

export type Road = { points: Pt[]; cum: number[]; length: number };

// Steps added by verifier loops (s1-r2) work at the desk of the step they repeat.
export const stationKeyOf = (step: StepView | undefined, stepId: string): string => {
  if (stepId === CEO_PLAN_STEP) return HQ;
  if (stepId === CEO_FINAL_STEP) return FINISH;
  return step?.loopOf ?? stepId;
};

export function stationOrder(run: RunView): string[] {
  const keys: string[] = [];
  for (const id of run.order) {
    const key = stationKeyOf(run.steps[id], id);
    if (key !== HQ && key !== FINISH && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Boustrophedon rows: up to 5 stops per row, alternating direction, with a gentle wave.
export function stopPositions(count: number, worldH = WORLD_H): Pt[] {
  const perRow = count <= 5 ? count : count <= 10 ? Math.ceil(count / 2) : Math.ceil(count / 3);
  const rows = Math.ceil(count / perRow);
  const marginX = 140;
  // Rows are centred vertically; extra height goes into the gaps.
  const rowGap = rows === 1 ? 0 : Math.min(330, (worldH - 340) / (rows - 1));
  const top = rows === 1 ? worldH * 0.62 : worldH * 0.5 - (rowGap * (rows - 1)) / 2 + 60;
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, count - row * perRow);
    const span = WORLD_W - marginX * 2;
    const step = inRow > 1 ? span / (inRow - 1) : 0;
    const ltr = row % 2 === 0;
    const x = inRow === 1 ? WORLD_W / 2 : ltr ? marginX + col * step : WORLD_W - marginX - col * step;
    const y = top + row * rowGap + (rows === 1 ? Math.sin(col * 1.3) * 40 : Math.sin(col * 1.1) * 18);
    pts.push({ x, y });
  }
  return pts;
}

// Catmull-Rom spline through the stops, sampled into a polyline with cumulative lengths.
export function buildRoad(stops: Pt[]): Road {
  if (stops.length < 2) {
    const p = stops[0] ?? { x: WORLD_W / 2, y: WORLD_H / 2 };
    return { points: [p], cum: [0], length: 0 };
  }
  const points: Pt[] = [];
  const get = (i: number) => stops[Math.max(0, Math.min(stops.length - 1, i))]!;
  const samples = 24;
  for (let i = 0; i < stops.length - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      points.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  points.push(stops[stops.length - 1]!);
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return { points, cum, length: cum[cum.length - 1]! };
}

export function pointAt(road: Road, dist: number): Pt & { angle: number } {
  const d = Math.max(0, Math.min(road.length, dist));
  let lo = 0, hi = road.cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (road.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const a = road.points[lo]!, b = road.points[Math.min(lo + 1, road.points.length - 1)]!;
  const seg = road.cum[lo + 1] !== undefined ? road.cum[lo + 1]! - road.cum[lo]! : 0;
  const t = seg > 0 ? (d - road.cum[lo]!) / seg : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export type Layout = { key: string; stations: Station[]; road: Road; byKey: Map<string, Station> };

export function layoutFor(run: RunView, agentInfo: (agentId: string) => { name: string; color: string; icon: string }, worldH = WORLD_H): Layout {
  const keys = stationOrder(run);
  const stops = stopPositions(keys.length + 2, worldH);
  const road = buildRoad(stops);
  const stationDist = stops.map((p) => {
    // Distance along the road of the sample closest to each stop.
    let best = 0, bestD = Infinity;
    road.points.forEach((q, i) => {
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bestD) (bestD = d), (best = i);
    });
    return road.cum[best]!;
  });
  const ceo = agentInfo("ceo");
  const stations: Station[] = [
    { key: HQ, label: t("stage.hq"), color: ceo.color, icon: "crown", agentId: "ceo", pos: stops[0]!, dist: stationDist[0]! },
    ...keys.map((key, i) => {
      const step = run.steps[key];
      const info = agentInfo(step?.agentId ?? key);
      return { key, label: info.name, color: info.color, icon: info.icon, agentId: step?.agentId ?? key, pos: stops[i + 1]!, dist: stationDist[i + 1]! };
    }),
    { key: FINISH, label: t("stage.delivery"), color: ceo.color, icon: "flag", agentId: "ceo", pos: stops[stops.length - 1]!, dist: stationDist[stops.length - 1]! },
  ];
  return { key: `${keys.join("|")}@${worldH}`, stations, road, byKey: new Map(stations.map((s) => [s.key, s])) };
}

// ---- choreography ----------------------------------------------------------------------------

export type Trip = { kind: "carry"; from: string; to: string; color: string } | { kind: "visit"; to: string };

// Turns run changes into robot trips: handoffs become "carry" trips, newly started steps become visits.
export class Director {
  private seenHandoffs = 0;
  private seenRunning = new Set<string>();
  private finished = false;
  started = false;
  queue: Trip[] = [];
  celebrate = false;

  // Returns the station the robot should stand at when it first appears.
  sync(run: RunView, colorOf: (stationKey: string) => string): string | null {
    let initial: string | null = null;
    if (!this.started) {
      this.started = true;
      // Joining mid-run or opening a finished run: skip the history, start where the action is.
      this.seenHandoffs = run.handoffs.length;
      for (const id of run.order) if (run.steps[id]?.status !== "pending" && run.steps[id]?.status !== "ready") this.seenRunning.add(id);
      if (run.status === "completed") {
        this.finished = true;
        return FINISH;
      }
      const running = run.order.filter((id) => run.steps[id]?.status === "running" || run.steps[id]?.status === "waiting_approval");
      initial = running.length > 0 ? stationKeyOf(run.steps[running[running.length - 1]!], running[running.length - 1]!) : HQ;
    }

    for (const h of run.handoffs.slice(this.seenHandoffs)) {
      const from = stationKeyOf(run.steps[h.from], h.from);
      const to = stationKeyOf(run.steps[h.to], h.to);
      if (from !== to) this.queue.push({ kind: "carry", from, to, color: colorOf(from) });
    }
    this.seenHandoffs = run.handoffs.length;

    for (const id of run.order) {
      const st = run.steps[id];
      if (!st || this.seenRunning.has(id) || (st.status !== "running" && st.status !== "waiting_approval")) continue;
      this.seenRunning.add(id);
      const to = stationKeyOf(st, id);
      if (!this.queue.some((t) => t.to === to)) this.queue.push({ kind: "visit", to });
    }

    if (run.status === "completed" && !this.finished) {
      this.finished = true;
      this.queue.push({ kind: "visit", to: FINISH });
      this.celebrate = true;
    }
    // Stay in sync with fast runs: keep only the latest few trips.
    if (this.queue.length > 4) this.queue = this.queue.slice(-4);
    return initial;
  }
}

const TOOL_LINES: Array<[RegExp, Key]> = [
  [/^StructuredOutput$/, "tool.plan"],
  [/^WebSearch$/, "tool.search"],
  [/^WebFetch$/, "tool.fetch"],
  [/^Read$/, "tool.read"],
  [/^(Glob|Grep)$/, "tool.look"],
  [/^Write$/, "tool.write"],
  [/^Edit$/, "tool.edit"],
  [/^Bash$/, "tool.bash"],
  [/^Skill$/, "tool.skill"],
  [/^mcp__([a-z0-9-]+)__/, "tool.mcp"],
];

export function toolLine(tool: string | undefined): string {
  if (!tool) return t("tool.thinking");
  for (const [re, key] of TOOL_LINES) {
    const m = re.exec(tool);
    if (m) return t(key, { name: m[1] ?? "" });
  }
  return tool;
}

// What a desk worker is doing, chosen from the current tool and the agent's role (drawn by draw.ts drawWorker).
export type Activity = "type" | "read" | "search" | "think" | "paint" | "write" | "translate" | "shout" | "chart" | "test" | "scan" | "review" | "plan" | "blueprint" | "skill" | "call";

const ROLE_MAKE: Record<string, Activity> = {
  researcher: "search",
  "business-analyst": "plan",
  architect: "blueprint",
  coder: "type",
  reviewer: "review",
  tester: "test",
  security: "scan",
  "doc-writer": "write",
  "data-analyst": "chart",
  "project-manager": "plan",
  designer: "paint",
  translator: "translate",
  marketer: "shout",
  ceo: "plan",
};

export function activityFor(agentId: string, tool: string | undefined): Activity {
  const role = ROLE_MAKE[agentId] ?? "type";
  if (!tool) return role === "type" ? "think" : role;
  if (tool === "WebSearch" || tool === "WebFetch") return "search";
  if (tool === "Read" || tool === "Glob" || tool === "Grep") return role === "review" || role === "scan" ? role : "read";
  if (tool === "Skill") return "skill";
  if (tool === "StructuredOutput") return "plan";
  if (tool.startsWith("mcp__")) return "call";
  if (tool === "Bash") return role === "test" || role === "scan" || role === "chart" ? role : "type";
  // Write / Edit: the role's own way of making things.
  return role === "search" || role === "review" ? "write" : role;
}

export type Mood = "idle" | "working" | "waiting" | "done" | "failed" | "off";

export function moodFor(status: string, working: boolean): Mood {
  if (status === "waiting_approval") return "waiting";
  if (working || status === "running") return "working";
  if (status === "succeeded") return "done";
  if (status === "failed") return "failed";
  if (status === "skipped" || status === "cancelled") return "off";
  return "idle";
}
