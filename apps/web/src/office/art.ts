// Pixel art for the office floor (docs/17), drawn with rectangles so there are no image files to ship or license.
// Everything is in "world pixels"; the canvas is scaled up afterwards.
type Ctx = CanvasRenderingContext2D;

export const PAL = {
  wallTop: "#59658c",
  wall: "#424d70",
  wallLow: "#333c5a",
  wallDark: "#161b2c",
  plankA: "#8a6a4c",
  plankB: "#82634a",
  plankLine: "#6d5340",
  corridorA: "#39425c",
  corridorB: "#3d4762",
  carpetBoss: "#5a3a5e",
  carpetMeet: "#2f5560",
  carpetLab: "#3e4478",
  carpetKitchen: "#c9b79a",
  wood: "#c9925a",
  woodDark: "#92623a",
  woodEdge: "#6f4826",
  screenOff: "#0b1020",
  metal: "#aab3ca",
  metalDark: "#5c667f",
  plant: "#46b574",
  plantDark: "#2e8552",
  pot: "#b25a33",
  paper: "#f4f7fb",
  ink: "#111827",
  outline: "#141a2b",
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

const SKIN = ["#f6d3b0", "#eab98c", "#d49a6a", "#a8703f", "#f9e0c7", "#7d4e2d"];
const HAIR = ["#1c1917", "#3f2a1c", "#6f4524", "#96602c", "#b98a2e", "#2b2e3b", "#8a2f2f", "#9aa0b0", "#c2571f"];

export type Look = { skin: string; hair: string; style: number; shirt: string; glasses: boolean; beard: boolean; pants: string };
export const lookFor = (id: string, color: string): Look => {
  const h = hash(id);
  const style = (h >>> 9) % 5;
  return {
    skin: SKIN[h % SKIN.length]!,
    hair: HAIR[(h >>> 4) % HAIR.length]!,
    style,
    shirt: color,
    glasses: (h >>> 13) % 4 === 0,
    beard: style !== 2 && style !== 3 && (h >>> 16) % 5 === 0,
    pants: ["#1e2538", "#2b2f44", "#3a2f2a", "#27364a"][(h >>> 19) % 4]!,
  };
};

export type Pose = { facing: "up" | "down" | "left" | "right"; walking: boolean; seated: boolean; typing: boolean; t: number };

// A person about 12 wide and 24 tall, standing on (x, y) (the feet). Seated people are drawn from the waist up;
// the chair back is drawn over them by the caller.
export function drawPerson(ctx: Ctx, x: number, y: number, look: Look, pose: Pose) {
  const step = pose.walking ? Math.floor(pose.t * 8) % 4 : 0;
  const lift = pose.walking && (step === 1 || step === 3) ? 1 : 0;
  const tap = pose.typing ? Math.floor(pose.t * 6) % 2 : 0;
  const top = Math.round(y) - 23 + (pose.seated ? 5 : 0) - lift;
  const bodyY = top + 10;
  const back = pose.facing === "up";
  const side = pose.facing === "left" ? -1 : pose.facing === "right" ? 1 : 0;
  const o = PAL.outline;

  if (!pose.seated) {
    ctx.fillStyle = "rgba(0,0,0,.30)";
    ctx.fillRect(Math.round(x) - 6, Math.round(y) - 1, 12, 3);
    // legs and shoes
    const a = pose.walking ? (step < 2 ? 1 : -1) : 0;
    px(ctx, x - 4, y - 7, 3, 6 - (a > 0 ? 1 : 0), look.pants);
    px(ctx, x + 1, y - 7, 3, 6 - (a < 0 ? 1 : 0), look.pants);
    px(ctx, x - 4 + (side < 0 ? -1 : 0), y - 1 - (a > 0 ? 1 : 0), 3 + (side !== 0 ? 1 : 0), 1, "#0b0f1a");
    px(ctx, x + 1 + (side < 0 ? -1 : 0), y - 1 - (a < 0 ? 1 : 0), 3 + (side !== 0 ? 1 : 0), 1, "#0b0f1a");
  }
  // torso with a dark outline so people read against any floor
  px(ctx, x - 6, bodyY - 1, 12, 10, o);
  px(ctx, x - 5, bodyY, 10, 8, look.shirt);
  px(ctx, x - 5, bodyY + 6, 10, 2, shade(look.shirt, -0.2));
  if (!back && side === 0) {
    px(ctx, x - 1, bodyY, 2, 2, look.skin); // open collar
    px(ctx, x - 2, bodyY, 1, 3, shade(look.shirt, 0.3));
    px(ctx, x + 1, bodyY, 1, 3, shade(look.shirt, 0.3));
  }
  // arms: swing when walking, reach forward when typing
  const swing = pose.walking ? (step < 2 ? 1 : -1) : 0;
  const armC = shade(look.shirt, -0.12);
  if (pose.typing) {
    px(ctx, x - 7, bodyY + 1 - tap, 2, 4, armC);
    px(ctx, x + 5, bodyY + 1 - (1 - tap), 2, 4, armC);
    px(ctx, x - 7, bodyY - tap, 2, 1, look.skin);
    px(ctx, x + 5, bodyY - (1 - tap), 2, 1, look.skin);
  } else if (side === 0) {
    px(ctx, x - 7, bodyY + 1 + swing, 2, 6, armC);
    px(ctx, x + 5, bodyY + 1 - swing, 2, 6, armC);
    px(ctx, x - 7, bodyY + 7 + swing, 2, 1, look.skin);
    px(ctx, x + 5, bodyY + 7 - swing, 2, 1, look.skin);
  } else {
    px(ctx, x - 1 + swing * 2, bodyY + 1, 2, 6, armC);
    px(ctx, x - 1 + swing * 2, bodyY + 7, 2, 1, look.skin);
  }
  // head
  px(ctx, x - 6, top - 1, 12, 11, o);
  px(ctx, x - 5, top, 10, 9, look.skin);
  const h = look.hair;
  if (look.style !== 4) px(ctx, x - 5, top - 1, 10, 3, h);
  if (look.style === 0) px(ctx, x - 5, top + 2, 1, 2, h), px(ctx, x + 4, top + 2, 1, 2, h);
  if (look.style === 1) px(ctx, x - 5, top + 2, 2, 3, h), px(ctx, x + 4, top + 2, 1, 2, h), px(ctx, x - 2, top + 2, 4, 1, h);
  if (look.style === 2) px(ctx, x - 6, top + 1, 2, 10, h), px(ctx, x + 4, top + 1, 2, 10, h);
  if (look.style === 3) px(ctx, x - 2, top - 4, 4, 3, h), px(ctx, x - 5, top + 2, 1, 3, h), px(ctx, x + 4, top + 2, 1, 3, h);
  if (look.style === 4) px(ctx, x - 5, top + 1, 1, 4, h), px(ctx, x + 4, top + 1, 1, 4, h), px(ctx, x - 5, top, 10, 1, shade(look.skin, 0.2));
  if (back) {
    // from behind the whole head is hair (a thin fringe of skin for the short cuts)
    px(ctx, x - 5, top - 1, 10, look.style === 2 ? 11 : 8, h);
    px(ctx, x - 5, top - 1, 10, 1, shade(h, 0.25));
    if (look.style === 4) px(ctx, x - 2, top, 4, 3, shade(look.skin, 0.1));
  } else if (side === 0) {
    px(ctx, x - 3, top + 4, 2, 2, "#fff");
    px(ctx, x + 1, top + 4, 2, 2, "#fff");
    px(ctx, x - 2, top + 5, 1, 1, PAL.ink);
    px(ctx, x + 1, top + 5, 1, 1, PAL.ink);
    px(ctx, x - 1, top + 7, 2, 1, shade(look.skin, -0.3));
    if (look.beard) px(ctx, x - 4, top + 6, 8, 3, h), px(ctx, x - 1, top + 7, 2, 1, shade(look.skin, -0.2));
    if (look.glasses) px(ctx, x - 4, top + 3, 8, 1, PAL.ink), px(ctx, x - 4, top + 4, 1, 2, PAL.ink), px(ctx, x - 1, top + 4, 1, 1, PAL.ink), px(ctx, x + 3, top + 4, 1, 2, PAL.ink);
  } else {
    const ex = side < 0 ? x - 4 : x + 2;
    px(ctx, ex, top + 4, 2, 2, "#fff");
    px(ctx, side < 0 ? ex : ex + 1, top + 5, 1, 1, PAL.ink);
    px(ctx, side < 0 ? x + 1 : x - 5, top + 1, 4, look.style === 2 ? 9 : 5, h);
    if (look.beard) px(ctx, side < 0 ? x - 5 : x + 1, top + 6, 4, 3, h);
    if (look.glasses) px(ctx, side < 0 ? x - 5 : x + 1, top + 3, 4, 1, PAL.ink);
  }
}

// An office chair seen from above. `backOnly` draws just the back rest, over a seated person.
export function drawChair(ctx: Ctx, x: number, y: number, color = "#465173", backOnly = false) {
  if (!backOnly) {
    px(ctx, x - 6, y - 12, 12, 11, PAL.outline);
    px(ctx, x - 5, y - 11, 10, 9, color);
    px(ctx, x - 1, y - 2, 2, 3, PAL.metalDark);
    px(ctx, x - 4, y + 1, 8, 1, PAL.metalDark);
  }
  px(ctx, x - 6, y - 7, 12, 6, PAL.outline);
  px(ctx, x - 5, y - 6, 10, 4, shade(color, 0.12));
  px(ctx, x - 5, y - 6, 10, 1, shade(color, 0.3));
}

// A desk with a monitor; (x, y) is the top-left of a 32x18 footprint. `glow` lights the screen while its owner works.
export function drawDesk(ctx: Ctx, x: number, y: number, glow: string | null, t: number, extras = 0, boss = false) {
  const wood = boss ? "#a8683c" : PAL.wood;
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.fillRect(x + 1, y + 19, 32, 3);
  px(ctx, x - 1, y + 3, 34, 17, PAL.outline);
  px(ctx, x, y + 4, 32, 11, wood);
  px(ctx, x, y + 4, 32, 1, shade(wood, 0.3));
  px(ctx, x, y + 15, 32, 4, boss ? "#7a4424" : PAL.woodDark);
  px(ctx, x + 2, y + 16, 9, 2, shade(PAL.woodDark, -0.2)); // drawer
  px(ctx, x + 6, y + 17, 2, 1, PAL.metal);
  // monitor
  px(ctx, x + 8, y - 7, 16, 12, PAL.outline);
  px(ctx, x + 9, y - 6, 14, 10, "#222b44");
  px(ctx, x + 10, y - 5, 12, 8, glow ? shade(glow, -0.62) : PAL.screenOff);
  if (glow) {
    const line = Math.floor(t * 6) % 6;
    for (let i = 0; i < 4; i++) {
      const w = i === line % 4 ? 9 : 3 + ((i * 3 + Math.floor(t * 1.5)) % 6);
      px(ctx, x + 11, y - 4 + i * 2, Math.min(10, w), 1, i % 2 ? shade(glow, 0.55) : shade(glow, 0.2));
    }
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.1 + 0.03 * Math.sin(t * 3);
    ctx.fillRect(x + 4, y + 2, 24, 12);
    ctx.globalAlpha = 1;
  } else {
    px(ctx, x + 11, y - 4, 3, 1, "#1e293b");
  }
  px(ctx, x + 15, y + 5, 2, 2, PAL.metalDark);
  px(ctx, x + 12, y + 7, 8, 1, PAL.metalDark);
  // keyboard and mouse
  px(ctx, x + 10, y + 10, 11, 3, "#dfe4ee");
  px(ctx, x + 11, y + 11, 9, 1, "#aab3ca");
  px(ctx, x + 23, y + 10, 2, 3, "#dfe4ee");
  // small things that make desks differ
  const k = extras % 5;
  if (k === 0) px(ctx, x + 3, y + 7, 4, 5, "#e2725b"), px(ctx, x + 3, y + 7, 4, 1, "#f8fafc"), px(ctx, x + 7, y + 9, 1, 2, "#e2725b");
  if (k === 1) px(ctx, x + 26, y + 7, 4, 6, PAL.paper), px(ctx, x + 27, y + 8, 2, 1, "#94a3b8"), px(ctx, x + 27, y + 10, 2, 1, "#94a3b8");
  if (k === 2) px(ctx, x + 26, y + 2, 4, 4, PAL.plant), px(ctx, x + 27, y, 2, 3, PAL.plantDark), px(ctx, x + 26, y + 6, 4, 4, PAL.pot);
  if (k === 3) px(ctx, x + 3, y + 6, 5, 7, "#fde68a"), px(ctx, x + 4, y + 8, 3, 1, "#b45309"), px(ctx, x + 4, y + 10, 3, 1, "#b45309");
  if (k === 4) px(ctx, x + 2, y + 5, 3, 8, "#60a5fa"), px(ctx, x + 5, y + 6, 3, 7, "#f87171"), px(ctx, x + 26, y + 8, 3, 4, "#f8fafc");
  if (boss) px(ctx, x + 2, y + 7, 7, 3, "#fbbf24"), px(ctx, x + 3, y + 8, 5, 1, "#92400e");
}

export function drawPlant(ctx: Ctx, x: number, y: number, big = false) {
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(x - 4, y, 8, 2);
  px(ctx, x - 4, y - 6, 8, 7, PAL.outline);
  px(ctx, x - 3, y - 5, 6, 5, PAL.pot);
  px(ctx, x - 3, y - 5, 6, 1, shade(PAL.pot, 0.3));
  const hgt = big ? 16 : 11;
  px(ctx, x - 5, y - 6 - hgt + 4, 10, hgt - 4, PAL.plant);
  px(ctx, x - 3, y - 6 - hgt, 6, 5, PAL.plant);
  px(ctx, x - 5, y - 12, 3, 4, PAL.plantDark);
  px(ctx, x + 1, y - 6 - hgt + 2, 3, 4, PAL.plantDark);
  px(ctx, x - 1, y - 10, 2, 3, shade(PAL.plant, 0.3));
}

export function drawShelf(ctx: Ctx, x: number, y: number, w = 60) {
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(x + 1, y + 30, w, 3);
  px(ctx, x - 1, y - 1, w + 2, 32, PAL.outline);
  px(ctx, x, y, w, 30, PAL.woodDark);
  const books = ["#e2725b", "#5aa9e6", "#f2c14e", "#7bc67b", "#b784d6", "#f1f5f9", "#f59e0b"];
  for (let row = 0; row < 3; row++) {
    px(ctx, x + 2, y + 2 + row * 9, w - 4, 8, "#2f2217");
    let bx = x + 3;
    let i = 0;
    while (bx < x + w - 5) {
      const bw = 2 + ((i * 7 + row * 3) % 3 === 0 ? 1 : 0);
      const lean = (i * 5 + row) % 7 === 0 ? 2 : 0;
      px(ctx, bx, y + 3 + row * 9 + lean, bw, 7 - lean, books[(i * 3 + row * 2) % books.length]!);
      bx += bw + ((i + row) % 6 === 5 ? 3 : 1);
      i++;
    }
  }
}

export function drawServer(ctx: Ctx, x: number, y: number, t: number, busy: boolean) {
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(x + 1, y + 34, 30, 3);
  for (let i = 0; i < 2; i++) {
    const bx = x + i * 15;
    px(ctx, bx - 1, y - 1, 15, 36, PAL.outline);
    px(ctx, bx, y, 13, 34, "#262f47");
    px(ctx, bx, y, 13, 2, "#3f4b6b");
    for (let r = 0; r < 7; r++) {
      px(ctx, bx + 2, y + 4 + r * 4, 9, 3, "#0f1524");
      const on = busy ? (Math.floor(t * 8) + r + i) % 3 !== 0 : r % 3 === 0;
      px(ctx, bx + 9, y + 5 + r * 4, 1, 1, on ? "#4ade80" : "#2a3550");
      px(ctx, bx + 7, y + 5 + r * 4, 1, 1, busy && (Math.floor(t * 5) + r) % 4 === 0 ? "#fbbf24" : "#2a3550");
      px(ctx, bx + 3, y + 5 + r * 4, 3, 1, "#1e293b");
    }
  }
}

export function drawGlobeDesk(ctx: Ctx, x: number, y: number, t: number, busy: boolean) {
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.fillRect(x + 1, y + 25, 30, 3);
  px(ctx, x - 1, y + 10, 32, 15, PAL.outline);
  px(ctx, x, y + 11, 30, 9, PAL.metal);
  px(ctx, x, y + 11, 30, 1, "#d5dbea");
  px(ctx, x, y + 20, 30, 4, PAL.metalDark);
  px(ctx, x + 4, y - 7, 22, 17, PAL.outline);
  px(ctx, x + 5, y - 6, 20, 15, "#222b44");
  px(ctx, x + 6, y - 5, 18, 13, busy ? "#0c3f63" : PAL.screenOff);
  const c = busy ? "#7dd3fc" : "#2a3550";
  px(ctx, x + 12, y - 3, 6, 9, c);
  px(ctx, x + 10, y - 1, 10, 5, c);
  px(ctx, x + 11, y - 2, 8, 7, c);
  const bg = busy ? "#0c3f63" : PAL.screenOff;
  px(ctx, x + 10, y + 1, 10, 1, bg);
  px(ctx, x + 12 + (busy ? Math.floor(t * 4) % 6 : 2), y - 3, 1, 9, bg);
  if (busy) px(ctx, x + 7, y + 6, 4 + (Math.floor(t * 3) % 8), 1, "#bae6fd");
  px(ctx, x + 9, y + 14, 12, 3, "#e5e9f2");
}

export function drawCoffee(ctx: Ctx, x: number, y: number, t: number) {
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.fillRect(x + 1, y + 24, 40, 3);
  px(ctx, x - 1, y + 9, 42, 15, PAL.outline);
  px(ctx, x, y + 10, 40, 8, "#eef1f7");
  px(ctx, x, y + 18, 40, 5, "#8b93a8");
  px(ctx, x + 8, y + 19, 1, 3, "#5c667f");
  px(ctx, x + 20, y + 19, 1, 3, "#5c667f");
  // coffee machine
  px(ctx, x + 2, y - 5, 13, 15, PAL.outline);
  px(ctx, x + 3, y - 4, 11, 13, "#2d3345");
  px(ctx, x + 5, y - 2, 7, 3, "#ef4444");
  px(ctx, x + 6, y + 4, 5, 5, "#f8fafc");
  px(ctx, x + 11, y + 5, 1, 2, "#f8fafc");
  const s = Math.floor(t * 2) % 3;
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.fillRect(x + 7 + (s === 1 ? 1 : 0), y + 1 - s, 1, 2);
  ctx.fillRect(x + 9 - (s === 2 ? 1 : 0), y - s, 1, 2);
  // sink, cups, fruit
  px(ctx, x + 19, y + 11, 9, 5, "#aab3ca");
  px(ctx, x + 20, y + 12, 7, 3, "#6b7896");
  px(ctx, x + 31, y + 11, 2, 3, "#fca5a5");
  px(ctx, x + 34, y + 11, 2, 3, "#93c5fd");
  px(ctx, x + 31, y + 15, 5, 2, "#fbbf24");
}

export function drawWaterCooler(ctx: Ctx, x: number, y: number, t: number) {
  px(ctx, x - 1, y - 9, 9, 24, PAL.outline);
  px(ctx, x, y - 8, 7, 9, "#7dd3fc");
  px(ctx, x + 1, y - 7, 2, 5, "#e0f2fe");
  if (Math.floor(t) % 5 === 0) px(ctx, x + 4, y - 3 - (Math.floor(t * 6) % 4), 1, 1, "#e0f2fe");
  px(ctx, x, y + 1, 7, 13, "#eef1f7");
  px(ctx, x + 2, y + 4, 3, 2, "#3b82f6");
}

export function drawSofa(ctx: Ctx, x: number, y: number) {
  px(ctx, x - 1, y - 1, 34, 17, PAL.outline);
  px(ctx, x, y, 32, 6, "#b45f6b");
  px(ctx, x, y + 6, 32, 9, "#cf7783");
  px(ctx, x, y + 6, 3, 9, "#b45f6b");
  px(ctx, x + 29, y + 6, 3, 9, "#b45f6b");
  px(ctx, x + 15, y + 7, 1, 7, "#b45f6b");
  px(ctx, x + 5, y + 7, 6, 4, "#fde68a");
}

export function drawMeetingTable(ctx: Ctx, x: number, y: number, w: number) {
  const n = Math.floor((w - 8) / 14);
  for (let i = 0; i < n; i++) drawChair(ctx, x + 11 + i * 14, y + 1, "#8a4a62");
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.fillRect(x + 1, y + 23, w, 3);
  px(ctx, x - 1, y - 1, w + 2, 24, PAL.outline);
  px(ctx, x, y, w, 18, PAL.wood);
  px(ctx, x, y, w, 1, shade(PAL.wood, 0.3));
  px(ctx, x + 4, y + 8, w - 8, 1, shade(PAL.wood, -0.1));
  px(ctx, x, y + 18, w, 4, PAL.woodDark);
  px(ctx, x + w / 2 - 12, y + 4, 9, 7, PAL.paper);
  px(ctx, x + w / 2 + 4, y + 5, 7, 5, "#1f2937");
  px(ctx, x + w / 2 + 5, y + 6, 5, 3, "#60a5fa");
  for (let i = 0; i < n; i++) drawChair(ctx, x + 11 + i * 14, y + 38, "#8a4a62");
}

// The task board on the wall: sticky notes in three columns (todo, doing, done).
export function drawBoard(ctx: Ctx, x: number, y: number, counts: [number, number, number]) {
  px(ctx, x - 1, y - 1, 58, 20, PAL.outline);
  px(ctx, x, y, 56, 18, "#eef2f8");
  px(ctx, x, y, 56, 2, "#cbd5e1");
  const cols = ["#fbbf24", "#60a5fa", "#4ade80"];
  for (let c = 0; c < 3; c++) {
    if (c > 0) px(ctx, x + c * 19 - 1, y + 3, 1, 14, "#cbd5e1");
    px(ctx, x + 2 + c * 19, y + 3, 6, 1, cols[c]!);
    for (let i = 0; i < Math.min(6, counts[c]!); i++) px(ctx, x + 2 + c * 19 + (i % 3) * 5, y + 6 + Math.floor(i / 3) * 6, 4, 4, cols[c]!);
  }
}

// Sky through the windows follows the real time of day.
export function skyFor(hour: number): { sky: string; cloud: string; night: boolean } {
  if (hour >= 7 && hour < 17) return { sky: "#9fd0f5", cloud: "rgba(255,255,255,.85)", night: false };
  if (hour >= 17 && hour < 20) return { sky: "#f4a26b", cloud: "rgba(255,225,200,.8)", night: false };
  if (hour >= 5 && hour < 7) return { sky: "#f2b6a0", cloud: "rgba(255,235,220,.8)", night: false };
  return { sky: "#1b2750", cloud: "rgba(255,255,255,.0)", night: true };
}

export function drawWindow(ctx: Ctx, x: number, y: number, t: number, hour: number) {
  const s = skyFor(hour);
  px(ctx, x - 1, y - 1, 28, 15, PAL.outline);
  px(ctx, x, y, 26, 13, s.sky);
  if (s.night) {
    for (let i = 0; i < 5; i++) if ((Math.floor(t * 1.5) + i) % 4 !== 0) px(ctx, x + 3 + ((i * 11) % 21), y + 2 + ((i * 5) % 8), 1, 1, "#f8fafc");
    px(ctx, x + 19, y + 2, 3, 3, "#fde68a");
  } else {
    ctx.fillStyle = s.cloud;
    const cx = x + ((Math.floor(t * 1.2) + x) % 34) - 6;
    if (cx > x - 1 && cx < x + 20) ctx.fillRect(Math.max(x, cx), y + 3, 7, 2), ctx.fillRect(Math.max(x, cx + 2), y + 2, 4, 1);
  }
  px(ctx, x, y, 26, 1, "#e5e9f2");
  px(ctx, x + 12, y, 2, 13, "#e5e9f2");
  px(ctx, x - 1, y + 13, 28, 2, "#cbd5e1");
}

export function drawClock(ctx: Ctx, x: number, y: number, date: Date) {
  px(ctx, x - 1, y - 1, 11, 11, PAL.outline);
  px(ctx, x, y, 9, 9, "#f8fafc");
  const cx = x + 4;
  const cy = y + 4;
  const hand = (angle: number, len: number, c: string) => {
    for (let i = 1; i <= len; i++) px(ctx, cx + Math.round(Math.sin(angle) * i), cy - Math.round(Math.cos(angle) * i), 1, 1, c);
  };
  hand(((date.getHours() % 12) + date.getMinutes() / 60) * (Math.PI / 6), 2, PAL.ink);
  hand(date.getMinutes() * (Math.PI / 30), 3, "#ef4444");
  px(ctx, cx, cy, 1, 1, PAL.ink);
}

export function drawPoster(ctx: Ctx, x: number, y: number, kind: number) {
  px(ctx, x - 1, y - 1, 14, 14, PAL.outline);
  px(ctx, x, y, 12, 12, kind === 0 ? "#fef3c7" : kind === 1 ? "#dbeafe" : "#fce7f3");
  if (kind === 0) px(ctx, x + 2, y + 7, 2, 3, "#f59e0b"), px(ctx, x + 5, y + 5, 2, 5, "#f59e0b"), px(ctx, x + 8, y + 2, 2, 8, "#f59e0b");
  if (kind === 1) px(ctx, x + 2, y + 3, 8, 1, "#3b82f6"), px(ctx, x + 2, y + 5, 6, 1, "#3b82f6"), px(ctx, x + 2, y + 7, 7, 1, "#3b82f6"), px(ctx, x + 2, y + 9, 4, 1, "#3b82f6");
  if (kind === 2) px(ctx, x + 4, y + 2, 4, 4, "#ec4899"), px(ctx, x + 3, y + 6, 6, 4, "#ec4899");
}

export function drawRug(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  px(ctx, x, y, w, h, shade(c, -0.15));
  px(ctx, x + 2, y + 2, w - 4, h - 4, c);
  px(ctx, x + 4, y + 4, w - 8, 1, shade(c, 0.25));
  px(ctx, x + 4, y + h - 5, w - 8, 1, shade(c, 0.25));
}

export function drawPrinter(ctx: Ctx, x: number, y: number, t: number, busy: boolean) {
  px(ctx, x - 1, y - 1, 18, 15, PAL.outline);
  px(ctx, x, y, 16, 8, "#dfe4ee");
  px(ctx, x, y + 8, 16, 5, "#aab3ca");
  px(ctx, x + 3, y - 3 + (busy ? Math.floor(t * 4) % 3 : 2), 10, 4, PAL.paper);
  px(ctx, x + 12, y + 2, 2, 1, busy ? "#4ade80" : "#94a3b8");
}

export function drawEnvelope(ctx: Ctx, x: number, y: number) {
  px(ctx, x - 7, y - 5, 14, 10, PAL.outline);
  px(ctx, x - 6, y - 4, 12, 8, "#fffbeb");
  px(ctx, x - 6, y - 4, 12, 1, "#fde68a");
  px(ctx, x - 5, y - 3, 1, 1, "#d97706");
  px(ctx, x - 4, y - 2, 1, 1, "#d97706");
  px(ctx, x - 3, y - 1, 1, 1, "#d97706");
  px(ctx, x - 2, y, 4, 1, "#d97706");
  px(ctx, x + 2, y - 1, 1, 1, "#d97706");
  px(ctx, x + 3, y - 2, 1, 1, "#d97706");
  px(ctx, x + 4, y - 3, 1, 1, "#d97706");
}
