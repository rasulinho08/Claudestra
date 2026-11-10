// Pixel art for the office floor (docs/17), drawn with rectangles so there are no image files to ship or license.
// Everything is in "world pixels"; the canvas is scaled up afterwards.
type Ctx = CanvasRenderingContext2D;

export const PAL = {
  floorA: "#27314a",
  floorB: "#2b3650",
  wallTop: "#4a5578",
  wall: "#394363",
  wallDark: "#1a2033",
  carpetBoss: "#4b3558",
  carpetMeet: "#2c4a55",
  carpetLab: "#3a3f66",
  carpetKitchen: "#4a4034",
  wood: "#c08a55",
  woodDark: "#8b5e34",
  woodEdge: "#6f4826",
  screenOff: "#0b1020",
  metal: "#9aa4bd",
  metalDark: "#5c667f",
  plant: "#3fa66a",
  plantDark: "#2b7a4b",
  pot: "#a0522d",
  paper: "#f1f5f9",
  ink: "#0f172a",
};

const px = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

const SKIN = ["#f2c9a1", "#e0ac7e", "#c68a5b", "#9a6540", "#f6d7b8", "#7a4b2c"];
const HAIR = ["#1f1a17", "#3b2a1d", "#6b4423", "#8d5a2b", "#c9a15a", "#2d2f3a", "#7c2d2d", "#b8b8c0"];

export type Look = { skin: string; hair: string; style: number; shirt: string };
export const lookFor = (id: string, color: string): Look => {
  const h = hash(id);
  return { skin: SKIN[h % SKIN.length]!, hair: HAIR[(h >> 4) % HAIR.length]!, style: (h >> 9) % 4, shirt: color };
};

export type Pose = { facing: "up" | "down" | "left" | "right"; walking: boolean; seated: boolean; typing: boolean; t: number };

// A person, 10 wide and about 20 tall, standing on (x, y) (the feet). Seated people are drawn from the waist up.
export function drawPerson(ctx: Ctx, x: number, y: number, look: Look, pose: Pose) {
  const step = pose.walking ? Math.floor(pose.t * 7) % 2 : 0;
  const bob = pose.walking ? step : pose.typing ? Math.floor(pose.t * 5) % 2 : 0;
  const pants = "#1e2538";
  const top = y - 19 + (pose.seated ? 4 : 0) + (pose.walking ? bob : 0);
  if (!pose.seated) {
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(Math.round(x - 5), Math.round(y - 1), 10, 2);
    px(ctx, x - 3, y - 5 + (step ? 1 : 0), 2, 5 - (step ? 1 : 0), pants);
    px(ctx, x + 1, y - 5 + (step ? 0 : pose.walking ? 1 : 0), 2, 5 - (step ? 0 : pose.walking ? 1 : 0), pants);
  }
  // body and arms
  const bodyY = top + 8;
  px(ctx, x - 4, bodyY, 8, 7, look.shirt);
  px(ctx, x - 4, bodyY + 5, 8, 2, shade(look.shirt, -0.22));
  const armSwing = pose.walking ? (step ? 1 : -1) : 0;
  const armUp = pose.typing ? (bob ? 1 : 0) : 0;
  px(ctx, x - 6, bodyY + 1 + armSwing - (pose.typing ? 1 : 0) - armUp, 2, 5, shade(look.shirt, -0.12));
  px(ctx, x + 4, bodyY + 1 - armSwing - (pose.typing ? 1 : 0) + armUp - (pose.typing ? 1 : 0), 2, 5, shade(look.shirt, -0.12));
  // head
  px(ctx, x - 4, top, 8, 8, look.skin);
  const back = pose.facing === "up";
  // hair: four simple cuts
  px(ctx, x - 4, top - 1, 8, 3, look.hair);
  if (look.style === 1) px(ctx, x - 5, top, 1, 5, look.hair), px(ctx, x + 4, top, 1, 5, look.hair);
  if (look.style === 2) px(ctx, x - 5, top, 1, 8, look.hair), px(ctx, x + 4, top, 1, 8, look.hair), px(ctx, x - 4, top + 7, 8, 2, back ? look.hair : "transparent");
  if (look.style === 3) px(ctx, x - 3, top - 2, 6, 1, look.hair);
  if (back) px(ctx, x - 4, top + 2, 8, look.style === 2 ? 6 : 4, look.hair);
  else if (pose.facing === "down") {
    px(ctx, x - 2, top + 4, 1, 2, PAL.ink);
    px(ctx, x + 1, top + 4, 1, 2, PAL.ink);
  } else {
    const dx = pose.facing === "left" ? -1 : 1;
    px(ctx, x + dx * 2 - (dx < 0 ? 0 : 1), top + 4, 1, 2, PAL.ink);
    px(ctx, pose.facing === "left" ? x + 2 : x - 4, top + 2, 2, 4, look.hair);
  }
}

export function drawChair(ctx: Ctx, x: number, y: number, color = "#3d4763") {
  px(ctx, x - 5, y - 9, 10, 8, color);
  px(ctx, x - 5, y - 9, 10, 2, shade(color, 0.18));
  px(ctx, x - 1, y - 1, 2, 2, PAL.metalDark);
}

// A desk with a monitor; (x, y) is the top-left of a 30x16 footprint. `glow` lights the screen while its owner works.
export function drawDesk(ctx: Ctx, x: number, y: number, glow: string | null, t: number, extras = 0) {
  px(ctx, x, y + 4, 30, 9, PAL.wood);
  px(ctx, x, y + 4, 30, 1, shade(PAL.wood, 0.25));
  px(ctx, x, y + 13, 30, 3, PAL.woodDark);
  px(ctx, x + 1, y + 16, 2, 3, PAL.woodEdge);
  px(ctx, x + 27, y + 16, 2, 3, PAL.woodEdge);
  // monitor
  px(ctx, x + 9, y - 4, 12, 9, "#1b2338");
  px(ctx, x + 10, y - 3, 10, 7, glow ? shade(glow, -0.55) : PAL.screenOff);
  if (glow) {
    const line = Math.floor(t * 6) % 5;
    for (let i = 0; i < 4; i++) px(ctx, x + 11, y - 2 + i * 1.6, i === line ? 7 : 3 + ((i * 3 + Math.floor(t * 2)) % 5), 1, shade(glow, 0.35));
  }
  px(ctx, x + 14, y + 5, 2, 2, PAL.metalDark);
  px(ctx, x + 12, y + 7, 6, 1, PAL.metalDark);
  // keyboard and small things that make desks differ
  px(ctx, x + 10, y + 9, 10, 2, "#d7dce8");
  if (extras % 3 === 0) px(ctx, x + 3, y + 6, 3, 4, "#e2725b"), px(ctx, x + 3, y + 6, 3, 1, "#f4f4f4");
  if (extras % 3 === 1) px(ctx, x + 23, y + 6, 4, 5, PAL.paper), px(ctx, x + 24, y + 7, 2, 1, "#94a3b8");
  if (extras % 3 === 2) px(ctx, x + 24, y + 3, 3, 3, PAL.plant), px(ctx, x + 24, y + 6, 3, 3, PAL.pot);
}

export function drawPlant(ctx: Ctx, x: number, y: number) {
  px(ctx, x - 3, y - 4, 6, 5, PAL.pot);
  px(ctx, x - 4, y - 12, 8, 8, PAL.plant);
  px(ctx, x - 2, y - 15, 4, 4, PAL.plant);
  px(ctx, x - 4, y - 9, 2, 3, PAL.plantDark);
  px(ctx, x + 1, y - 13, 2, 3, PAL.plantDark);
}

export function drawShelf(ctx: Ctx, x: number, y: number, w = 40) {
  px(ctx, x, y, w, 22, PAL.woodDark);
  const books = ["#e2725b", "#5aa9e6", "#f2c14e", "#7bc67b", "#b784d6", "#f1f5f9"];
  for (let row = 0; row < 2; row++) {
    px(ctx, x + 2, y + 2 + row * 10, w - 4, 8, "#3a2a1a");
    for (let i = 0; i < (w - 6) / 3; i++) px(ctx, x + 3 + i * 3, y + 3 + row * 10 + ((i * 7 + row) % 3 === 0 ? 1 : 0), 2, 7 - ((i * 7 + row) % 3 === 0 ? 1 : 0), books[(i * 5 + row * 2) % books.length]!);
  }
}

export function drawServer(ctx: Ctx, x: number, y: number, t: number, busy: boolean) {
  for (let i = 0; i < 2; i++) {
    const bx = x + i * 14;
    px(ctx, bx, y, 12, 26, "#232b40");
    px(ctx, bx, y, 12, 2, "#39445f");
    for (let r = 0; r < 5; r++) {
      px(ctx, bx + 2, y + 4 + r * 4, 8, 2, "#111827");
      const on = busy ? (Math.floor(t * 8) + r + i) % 3 !== 0 : r === 0;
      px(ctx, bx + 8, y + 4 + r * 4, 1, 1, on ? "#4ade80" : "#334155");
      px(ctx, bx + 6, y + 4 + r * 4, 1, 1, busy && (Math.floor(t * 5) + r) % 4 === 0 ? "#fbbf24" : "#334155");
    }
  }
}

export function drawGlobeDesk(ctx: Ctx, x: number, y: number, t: number, busy: boolean) {
  px(ctx, x, y + 10, 26, 8, PAL.metal);
  px(ctx, x, y + 18, 26, 3, PAL.metalDark);
  px(ctx, x + 4, y - 4, 18, 13, "#1b2338");
  px(ctx, x + 5, y - 3, 16, 11, busy ? "#0b3a5c" : PAL.screenOff);
  // a little globe on the screen
  const c = busy ? "#7dd3fc" : "#334155";
  px(ctx, x + 10, y - 1, 6, 7, c);
  px(ctx, x + 9, y + 1, 8, 3, c);
  if (busy) px(ctx, x + 10 + (Math.floor(t * 4) % 5), y - 1, 1, 7, "#0b3a5c");
  px(ctx, x + 9, y + 2, 8, 1, busy ? "#0b3a5c" : PAL.screenOff);
}

export function drawCoffee(ctx: Ctx, x: number, y: number, t: number) {
  px(ctx, x, y + 8, 34, 10, "#d9dee9");
  px(ctx, x, y + 18, 34, 3, PAL.metalDark);
  px(ctx, x + 3, y - 4, 10, 12, "#2a2f3d");
  px(ctx, x + 5, y - 2, 6, 3, "#ef4444");
  px(ctx, x + 6, y + 4, 4, 4, "#f8fafc");
  if (Math.floor(t * 2) % 2 === 0) px(ctx, x + 7, y + 1, 1, 2, "rgba(255,255,255,.5)");
  px(ctx, x + 18, y + 2, 12, 6, "#94a3b8");
  px(ctx, x + 19, y + 3, 10, 1, "#e2e8f0");
}

export function drawMeetingTable(ctx: Ctx, x: number, y: number, w: number) {
  for (let i = 0; i < Math.floor(w / 14); i++) {
    drawChair(ctx, x + 8 + i * 14, y + 2, "#7a3b52");
    drawChair(ctx, x + 8 + i * 14, y + 36, "#7a3b52");
  }
  px(ctx, x, y, w, 20, PAL.wood);
  px(ctx, x, y, w, 2, shade(PAL.wood, 0.25));
  px(ctx, x, y + 20, w, 4, PAL.woodDark);
  px(ctx, x + w / 2 - 6, y + 6, 12, 8, PAL.paper);
}

// The task board on the wall: sticky notes in three columns (todo, doing, done).
export function drawBoard(ctx: Ctx, x: number, y: number, counts: [number, number, number]) {
  px(ctx, x, y, 46, 22, "#e8edf5");
  px(ctx, x, y, 46, 1, "#94a3b8");
  px(ctx, x, y + 21, 46, 1, "#94a3b8");
  const cols = ["#fbbf24", "#60a5fa", "#4ade80"];
  for (let c = 0; c < 3; c++) {
    px(ctx, x + 15 * c + 15, y + 2, c < 2 ? 1 : 0, 18, "#cbd5e1");
    for (let i = 0; i < Math.min(6, counts[c]!); i++) px(ctx, x + 2 + c * 15 + (i % 2) * 6, y + 3 + Math.floor(i / 2) * 6, 5, 5, cols[c]!);
  }
}

export function drawWindow(ctx: Ctx, x: number, y: number, t: number) {
  px(ctx, x, y, 22, 12, "#a9c7e8");
  px(ctx, x, y, 22, 1, "#e2e8f0");
  px(ctx, x + 10, y, 2, 12, "#e2e8f0");
  px(ctx, x + 2 + (Math.floor(t / 3) % 6), y + 3, 5, 2, "rgba(255,255,255,.7)");
}

export function drawEnvelope(ctx: Ctx, x: number, y: number) {
  px(ctx, x - 5, y - 4, 10, 7, "#f8fafc");
  px(ctx, x - 5, y - 4, 10, 1, "#cbd5e1");
  px(ctx, x - 4, y - 3, 1, 1, "#94a3b8");
  px(ctx, x - 3, y - 2, 1, 1, "#94a3b8");
  px(ctx, x - 2, y - 1, 4, 1, "#94a3b8");
  px(ctx, x + 2, y - 2, 1, 1, "#94a3b8");
  px(ctx, x + 3, y - 3, 1, 1, "#94a3b8");
}
