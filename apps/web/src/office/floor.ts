// The office floor's logic (docs/17): where the rooms and desks are, where a worker should be for what it is
// doing, and how it walks there. No drawing here (see art.ts and OfficeFloor.tsx), so it can be tested.
export type Pt = { x: number; y: number };
export type Place = "desk" | "shelf" | "web" | "server" | "board" | "boss" | "coffee";
export type WorkStatus = "idle" | "working" | "waiting";

export const W = 576;
const ROOMS_BOTTOM = 108;
export const CORRIDOR_Y = 120;
const DESKS_TOP = 148;
const ROW_H = 58;
export const COLS = 6;
const DESK_X0 = 40;
const DESK_PITCH = 88;

export type Layout = {
  w: number;
  h: number;
  desks: Pt[]; // top-left of each desk
  bossDesk: Pt;
  rooms: { boss: [number, number]; meet: [number, number]; lab: [number, number]; kitchen: [number, number] };
  roomsBottom: number;
};

export function layoutFor(deskCount: number): Layout {
  const rows = Math.max(1, Math.ceil(deskCount / COLS));
  const desks: Pt[] = [];
  for (let i = 0; i < deskCount; i++) desks.push({ x: DESK_X0 + (i % COLS) * DESK_PITCH, y: DESKS_TOP + Math.floor(i / COLS) * ROW_H });
  return {
    w: W,
    h: DESKS_TOP + rows * ROW_H + 12,
    desks,
    bossDesk: { x: 44, y: 50 },
    rooms: { boss: [6, 124], meet: [130, 290], lab: [296, 440], kitchen: [446, 570] },
    roomsBottom: ROOMS_BOTTOM,
  };
}

export const seatOf = (desk: Pt): Pt => ({ x: desk.x + 16, y: desk.y + 34 });

// Where the i-th visitor of a shared place stands, so people do not pile onto one pixel.
export function spot(place: Exclude<Place, "desk">, i: number): Pt {
  const k = i % 5;
  switch (place) {
    case "boss":
      return { x: 86 + k * 8, y: 96 + (k % 2) * 6 };
    case "board":
      return { x: 146 + k * 7, y: 46 + (k % 2) * 5 };
    case "shelf":
      return { x: 308 + k * 10, y: 64 + (k % 2) * 5 };
    case "web":
      return { x: 392 + k * 8, y: 86 + (k % 2) * 5 };
    case "server":
      return { x: 458 + k * 6, y: 70 + (k % 2) * 5 };
    case "coffee":
      return { x: 512 + k * 8, y: 80 + (k % 2) * 5 };
  }
}

// Which place a tool call sends the worker to. Writing happens at the worker's own desk.
export function placeFor(status: WorkStatus, tool: string | null, isBoss = false): Place {
  if (status === "waiting") return "boss";
  if (status === "idle") return "desk";
  if (isBoss) return "board";
  if (!tool) return "desk";
  if (/^(Read|Glob|Grep|Skill)$/.test(tool)) return "shelf";
  if (/^(WebSearch|WebFetch)$/.test(tool)) return "web";
  if (tool === "Bash") return "server";
  return "desk";
}

const inDeskArea = (p: Pt) => p.y > CORRIDOR_Y + 8;
// The free lane just left of a desk column, and the free aisle just below a seat row.
const laneX = (p: Pt) => Math.max(20, Math.round((p.x - 16 - DESK_X0) / DESK_PITCH) * DESK_PITCH + DESK_X0 - 16);
const aisleY = (p: Pt) => Math.round((p.y - 34 - DESKS_TOP) / ROW_H) * ROW_H + DESKS_TOP + 42;

// Waypoints from a to b that stay in corridors, aisles and lanes (never across a desk).
export function route(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  let cur = a;
  const push = (p: Pt) => {
    if (p.x !== cur.x || p.y !== cur.y) out.push(p);
    cur = p;
  };
  if (inDeskArea(a)) {
    const ay = aisleY(a);
    if (inDeskArea(b) && aisleY(b) === ay) {
      push({ x: a.x, y: ay });
      push({ x: b.x, y: ay });
      push(b);
      return out;
    }
    push({ x: a.x, y: ay });
    push({ x: laneX(a), y: ay });
    push({ x: laneX(a), y: CORRIDOR_Y });
  } else {
    push({ x: a.x, y: CORRIDOR_Y });
  }
  if (inDeskArea(b)) {
    const by = aisleY(b);
    push({ x: laneX(b), y: CORRIDOR_Y });
    push({ x: laneX(b), y: by });
    push({ x: b.x, y: by });
  } else {
    push({ x: b.x, y: CORRIDOR_Y });
  }
  push(b);
  return out;
}

export type WorkerInput = { id: string; isBoss: boolean; status: WorkStatus; tool: string | null };

export type Actor = {
  id: string;
  pos: Pt;
  home: Pt; // the seat
  path: Pt[];
  place: Place;
  placeIndex: number;
  facing: "up" | "down" | "left" | "right";
  walking: boolean;
  status: WorkStatus;
  nextBreak: number;
  breakUntil: number;
};

export type Envelope = { from: Pt; to: Pt; start: number; duration: number };

const SPEED = 46; // world pixels per second

export class OfficeSim {
  actors = new Map<string, Actor>();
  envelopes: Envelope[] = [];
  layout: Layout = layoutFor(0);
  private order: string[] = [];

  // `calm` (reduced motion): no coffee breaks and no flying envelopes; people jump to their place.
  constructor(private calm = false) {}

  sync(workers: WorkerInput[], now: number) {
    const staff = workers.filter((w) => !w.isBoss);
    const ids = workers.map((w) => w.id).join("|");
    if (ids !== this.order.join("|")) {
      this.order = workers.map((w) => w.id);
      this.layout = layoutFor(staff.length);
      for (const id of [...this.actors.keys()]) if (!this.order.includes(id)) this.actors.delete(id);
    }
    const bossSeat: Pt = seatOf(this.layout.bossDesk);
    const using = new Map<Place, number>();
    let deskIndex = 0;
    for (const w of workers) {
      const home = w.isBoss ? bossSeat : seatOf(this.layout.desks[deskIndex++]!);
      let a = this.actors.get(w.id);
      if (!a) {
        a = { id: w.id, pos: { ...home }, home, path: [], place: "desk", placeIndex: 0, facing: "up", walking: false, status: "idle", nextBreak: now + 8000 + (hashOf(w.id) % 50_000), breakUntil: 0 };
        this.actors.set(w.id, a);
      }
      if (a.home.x !== home.x || a.home.y !== home.y) {
        a.home = home;
        if (a.place === "desk") this.send(a, "desk", 0, true);
      }
      // Messages: the boss hands work out, finished work goes back.
      if (!this.calm && !w.isBoss && w.status !== a.status) {
        if (a.status === "idle" && w.status === "working") this.envelopes.push({ from: bossSeat, to: a.home, start: now, duration: 1100 });
        if (a.status !== "idle" && w.status === "idle") this.envelopes.push({ from: a.pos, to: bossSeat, start: now, duration: 1100 });
      }
      a.status = w.status;
      let place = placeFor(w.status, w.tool, w.isBoss);
      // A short coffee break now and then for people with nothing to do.
      if (w.status === "idle" && !w.isBoss && !this.calm) {
        if (now > a.nextBreak) {
          a.breakUntil = now + 9000;
          a.nextBreak = now + 45_000 + (hashOf(w.id + now) % 60_000);
        }
        if (now < a.breakUntil) place = "coffee";
      } else {
        a.breakUntil = 0;
      }
      const index = using.get(place) ?? 0;
      using.set(place, index + 1);
      if (place !== a.place || (place !== "desk" && index !== a.placeIndex)) this.send(a, place, index, this.calm);
    }
  }

  private target(a: Actor, place: Place, index: number): Pt {
    return place === "desk" ? a.home : spot(place, index);
  }

  private send(a: Actor, place: Place, index: number, jump: boolean) {
    const to = this.target(a, place, index);
    a.place = place;
    a.placeIndex = index;
    if (jump) {
      a.pos = { ...to };
      a.path = [];
      a.walking = false;
      a.facing = "up";
      return;
    }
    // Finish the current leg first so a change of mind does not cut a corner through a desk.
    const from = a.path.length ? a.path[0]! : a.pos;
    a.path = [...(a.path.length ? [a.path[0]!] : []), ...route(from, to)];
  }

  step(dt: number, now: number) {
    for (const a of this.actors.values()) {
      let budget = SPEED * dt;
      a.walking = a.path.length > 0;
      while (budget > 0 && a.path.length) {
        const next = a.path[0]!;
        const dx = next.x - a.pos.x;
        const dy = next.y - a.pos.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= budget) {
          a.pos = { ...next };
          a.path.shift();
          budget -= dist;
        } else {
          if (Math.abs(dx) > 0.01) a.pos.x += Math.sign(dx) * budget;
          else a.pos.y += Math.sign(dy) * budget;
          budget = 0;
        }
        if (Math.abs(dx) > Math.abs(dy)) a.facing = dx < 0 ? "left" : "right";
        else if (dy !== 0) a.facing = dy < 0 ? "up" : "down";
      }
      if (!a.path.length && a.walking) a.facing = a.place === "coffee" || a.place === "boss" ? "up" : "up";
    }
    this.envelopes = this.envelopes.filter((e) => now < e.start + e.duration);
  }

  seated(a: Actor): boolean {
    return a.place === "desk" && a.path.length === 0;
  }
}

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
