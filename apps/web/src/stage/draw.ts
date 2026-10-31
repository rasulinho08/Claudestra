// Canvas drawing for the stage: background, road, desks, the Strativu robot and particles.
// Everything is simple fills and strokes (no blur filters) so it stays light on CPU/GPU.
import { MARK_ASPECT, MARK_BODY, MARK_LINES, MARK_ORBS } from "./strativuMark.ts";
import { WORLD_W, activityFor, moodFor, type Road, type Station } from "./world.ts";
import { drawWorker } from "./workers.ts";

// Size of desks, robot and text relative to world units.
export const UNIT = 1.45;
import { iconFor } from "../icons.ts";

export type Theme = { dark: boolean; transparent: boolean };

let markBody: Path2D | null = null;
let markLines: Path2D | null = null;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawBackground(ctx: CanvasRenderingContext2D, road: Road, theme: Theme, worldH: number) {
  ctx.clearRect(0, 0, WORLD_W, worldH);
  if (!theme.transparent) {
    const sky = ctx.createLinearGradient(0, 0, 0, worldH);
    sky.addColorStop(0, theme.dark ? "#0d1324" : "#dff3ff");
    sky.addColorStop(1, theme.dark ? "#121a2e" : "#f4fbff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_W, worldH);
    // Soft hills and a few stars/dots for depth.
    ctx.fillStyle = theme.dark ? "#16213a" : "#cfeede";
    ctx.beginPath();
    ctx.moveTo(0, worldH);
    for (let x = 0; x <= WORLD_W; x += 40) ctx.lineTo(x, worldH - 90 - Math.sin(x / 170) * 30 - Math.sin(x / 61) * 8);
    ctx.lineTo(WORLD_W, worldH);
    ctx.fill();
    ctx.fillStyle = theme.dark ? "rgba(255,255,255,0.35)" : "rgba(30,120,200,0.12)";
    for (let i = 0; i < 40; i++) {
      const x = (i * 337) % WORLD_W, y = (i * 191) % 260;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  if (road.points.length < 2) return;
  const trace = () => {
    ctx.beginPath();
    road.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  trace();
  ctx.strokeStyle = theme.dark ? "#0a0f1c" : "#9fb3c8";
  ctx.lineWidth = 50 * UNIT;
  ctx.stroke();
  trace();
  ctx.strokeStyle = theme.dark ? "#2a3550" : "#c9d6e3";
  ctx.lineWidth = 42 * UNIT;
  ctx.stroke();
  trace();
  ctx.setLineDash([14, 16]);
  ctx.strokeStyle = theme.dark ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);
}

export type DeskState = { status: string; working: boolean; tool?: string };

export function drawStation(ctx: CanvasRenderingContext2D, s: Station, state: DeskState, t: number, theme: Theme) {
  const { x, y } = s.pos;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(UNIT, UNIT);
  ctx.translate(-x, -y);
  const baseY = y - 46;
  // Platform
  ctx.fillStyle = theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,40,80,0.08)";
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 54, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  // Booth
  const w = 74, h = 54;
  rr(ctx, x - w / 2, baseY - h, w, h, 10);
  ctx.fillStyle = theme.dark ? "#1b2440" : "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = s.color;
  ctx.stroke();
  // Roof stripe
  rr(ctx, x - w / 2, baseY - h, w, 12, [10, 10, 0, 0]);
  ctx.fillStyle = s.color;
  ctx.fill();
  // Icon
  ctx.fillStyle = s.color;
  ctx.font = "bold 20px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s.icon === "flag" ? "⚑" : iconFor(s.icon), x, baseY - h / 2 + 5);
  // Status lamp
  const lamp = state.status === "succeeded" ? "#22c55e" : state.status === "failed" ? "#ef4444" : state.status === "waiting_approval" ? "#f59e0b" : state.working ? s.color : theme.dark ? "#3a4560" : "#c3ccd8";
  const pulse = state.working ? 0.5 + 0.5 * Math.sin(t * 6) : 1;
  ctx.globalAlpha = state.working ? 0.55 + 0.45 * pulse : 1;
  ctx.fillStyle = lamp;
  ctx.beginPath();
  ctx.arc(x + w / 2 - 9, baseY - h + 20, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // The agent's own little robot, doing its job at the desk (workers.ts).
  drawWorker(ctx, x - w / 2 - 24, y - 4, s.color, activityFor(s.agentId, state.tool), moodFor(state.status, state.working), t, theme.dark);
  // Badges
  if (state.status === "succeeded") badge(ctx, x + w / 2 - 2, baseY - h - 2, "#22c55e", "✓");
  if (state.status === "failed") badge(ctx, x + w / 2 - 2, baseY - h - 2, "#ef4444", "✕");
  if (state.status === "waiting_approval" && Math.floor(t * 2) % 2 === 0) badge(ctx, x + w / 2 - 2, baseY - h - 2, "#f59e0b", "?");
  // Label
  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = theme.dark ? "#e6e8ee" : "#1b2433";
  ctx.globalAlpha = state.status === "skipped" || state.status === "cancelled" ? 0.45 : 1;
  // Outline keeps labels readable over any background (OBS overlays).
  ctx.lineWidth = 4;
  ctx.strokeStyle = theme.dark || theme.transparent ? "rgba(5,10,25,0.85)" : "rgba(255,255,255,0.9)";
  ctx.strokeText(s.label, x, y + 28);
  ctx.fillText(s.label, x, y + 28);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, glyph: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(glyph, x, y + 1);
}

export type RobotPose = {
  x: number;
  y: number;
  hop: number; // height above ground
  squash: number; // 1 = normal, <1 squashed on landing
  facing: 1 | -1;
  walking: boolean;
  carrying: string | null;
  blink: boolean;
  happy: boolean;
  t: number;
};

// The Strativu robot: the Strativu mark as its head (visor with smiling eyes) on a slim hover body.
export function drawRobot(ctx: CanvasRenderingContext2D, p: RobotPose, theme: Theme) {
  if (!markBody) {
    markBody = new Path2D(MARK_BODY);
    markLines = new Path2D(MARK_LINES);
  }
  const { x, y } = p;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(UNIT, UNIT);
  ctx.translate(-x, -y);
  // Shadow shrinks while airborne.
  const shadow = Math.max(0.35, 1 - p.hop / 70);
  ctx.fillStyle = theme.dark ? "rgba(0,0,0,0.45)" : "rgba(0,30,60,0.18)";
  ctx.beginPath();
  ctx.ellipse(x, y + 2, 26 * shadow, 7 * shadow, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y - p.hop);
  ctx.scale(p.facing * (2 - p.squash), p.squash);

  // Body designed around the Strativu head: a slim hover-bot. The torso tapers from wide shoulders (under the
  // mark's wings) to a narrow waist and a hover pod; shoulder orbs and the chest core repeat the mark's three orbs.
  const moving = p.walking;
  const tilt = moving ? 0.06 : 0;
  ctx.rotate(tilt);

  // Hover pod and thruster flame (longer while moving or jumping).
  const flame = (moving ? 13 : 6) + Math.sin(p.t * 30) * 2 + Math.min(10, p.hop * 0.3);
  const fl = ctx.createLinearGradient(0, -8, 0, -8 + flame);
  fl.addColorStop(0, "rgba(127,227,255,0.95)");
  fl.addColorStop(1, "rgba(67,208,255,0)");
  ctx.beginPath();
  ctx.moveTo(-6, -8);
  ctx.quadraticCurveTo(0, -8 + flame * 1.25, 6, -8);
  ctx.closePath();
  ctx.fillStyle = fl;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -11, 11, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#0a1630";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -11, 6, 2.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#3cc8ff";
  ctx.fill();

  // Torso
  const torso = new Path2D();
  torso.moveTo(-23, -47);
  torso.quadraticCurveTo(-23, -53, -16, -54);
  torso.lineTo(16, -54);
  torso.quadraticCurveTo(23, -53, 23, -47);
  torso.bezierCurveTo(22, -33, 17, -20, 9, -15);
  torso.quadraticCurveTo(0, -12, -9, -15);
  torso.bezierCurveTo(-17, -20, -22, -33, -23, -47);
  torso.closePath();
  const body = ctx.createLinearGradient(-20, -53, 16, -14);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.55, "#e4ebf4");
  body.addColorStop(1, "#b9c7d8");
  ctx.fillStyle = body;
  ctx.fill(torso);
  ctx.strokeStyle = "#8696ad";
  ctx.lineWidth = 1.4;
  ctx.stroke(torso);
  // Navy accent lines echoing the mark's inner lines: shoulders down to the core.
  ctx.strokeStyle = "#0a1630";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-16, -51);
  ctx.quadraticCurveTo(-8, -40, -4, -33);
  ctx.moveTo(16, -51);
  ctx.quadraticCurveTo(8, -40, 4, -33);
  ctx.moveTo(-6, -21);
  ctx.quadraticCurveTo(0, -18, 6, -21);
  ctx.stroke();
  // Chest core: pulses gently, brighter while working or happy.
  const pulse = 0.5 + 0.5 * Math.sin(p.t * (p.happy ? 6 : 3));
  ctx.beginPath();
  ctx.arc(0, -30, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = "#0a1630";
  ctx.fill();
  const core = ctx.createRadialGradient(-1.5, -31.5, 0.5, 0, -30, 6);
  core.addColorStop(0, "#e6fbff");
  core.addColorStop(0.45, "#43d0ff");
  core.addColorStop(1, "#0b62d6");
  ctx.beginPath();
  ctx.arc(0, -30, 5.2 + pulse * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();
  // Arms in front of the body: outlined white limbs with navy hands, swinging while moving. When carrying, they are
  // drawn after the head (holding the packet up), see below.
  if (!p.carrying) drawArms(ctx, p, false);
  // Neck collar under the head.
  ctx.beginPath();
  ctx.ellipse(0, -53, 9, 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#0a1630";
  ctx.fill();
  ctx.rotate(-tilt);

  // Head: the Strativu mark
  const hw = 66;
  const hh = hw * MARK_ASPECT;
  ctx.save();
  ctx.translate(-hw / 2, -54 - hh + 7 + (p.walking ? Math.sin(p.t * 18) * 0.8 : 0));
  ctx.scale(hw, hw);
  const g = ctx.createLinearGradient(0, 0, 0, MARK_ASPECT);
  g.addColorStop(0, "#43d0ff");
  g.addColorStop(1, "#0b62d6");
  ctx.fillStyle = g;
  ctx.fill(markBody);
  ctx.fillStyle = "#0a1630";
  ctx.fill(markLines!);
  for (const [cx, cy, r] of MARK_ORBS) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#3cc8ff";
    ctx.fill();
    ctx.lineWidth = 0.014;
    ctx.strokeStyle = "#0a1630";
    ctx.stroke();
  }
  // Visor with eyes
  rr(ctx, 0.3, 0.4, 0.4, 0.2, 0.08);
  ctx.fillStyle = "#081a3a";
  ctx.fill();
  ctx.strokeStyle = "#7fe3ff";
  ctx.lineWidth = 0.028;
  ctx.lineCap = "round";
  for (const ex of [0.41, 0.59]) {
    ctx.beginPath();
    if (p.blink) {
      ctx.moveTo(ex - 0.035, 0.5);
      ctx.lineTo(ex + 0.035, 0.5);
    } else if (p.happy) {
      ctx.arc(ex, 0.52, 0.035, Math.PI * 1.1, Math.PI * 1.9);
    } else {
      ctx.arc(ex, 0.5, 0.022, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Packet held above the head
  if (p.carrying) drawArms(ctx, p, true);
  if (p.carrying) {
    const by = -54 - hh - 18 + Math.sin(p.t * 10) * 2;
    rr(ctx, -13, by, 26, 18, 4);
    ctx.fillStyle = p.carrying;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-13, by + 4);
    ctx.lineTo(0, by + 11);
    ctx.lineTo(13, by + 4);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function drawArms(ctx: CanvasRenderingContext2D, p: RobotPose, up: boolean) {
  const swing = p.walking ? Math.sin(p.t * 9) * 5 : Math.sin(p.t * 2) * 1;
  for (const side of [-1, 1] as const) {
    const s = { x: side * 21, y: -46 };
    // Carrying: hands hold the packet above the head. Happy (task done): a small cheer with both arms up.
    const cheer = !up && p.happy && !p.walking;
    const wave = cheer ? Math.sin(p.t * 8) * 3 : 0;
    const e = up ? { x: side * 36, y: -72 } : cheer ? { x: side * 33, y: -50 } : { x: side * 30, y: -34 + swing * side };
    const h = up ? { x: side * 15, y: -104 } : cheer ? { x: side * 40 + wave * side, y: -64 - wave } : { x: side * 28, y: -22 + swing * side * 1.4 };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [w, c] of [[7.5, "#8696ad"], [5, "#eef3f9"]] as const) {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.lineTo(h.x, h.y);
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.stroke();
    }
    // Elbow joint and hand.
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = "#3cc8ff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(h.x, h.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#0a1630";
    ctx.fill();
  }
}

export function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, theme: Theme, accent = "#43d0ff") {
  ctx.font = "600 21px ui-sans-serif, system-ui, sans-serif";
  const w = Math.min(ctx.measureText(text).width + 30, 520);
  const h = 42;
  const bx = Math.max(8, Math.min(WORLD_W - w - 8, x - w / 2));
  const by = Math.max(8, y - h);
  rr(ctx, bx, by, w, h, 12);
  ctx.fillStyle = theme.dark ? "#ffffff" : "#0d1324";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 7, by + h);
  ctx.lineTo(x, by + h + 9);
  ctx.lineTo(x + 7, by + h);
  ctx.fillStyle = theme.dark ? "#ffffff" : "#0d1324";
  ctx.fill();
  ctx.fillStyle = theme.dark ? "#0d1324" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.length > 44 ? `${text.slice(0, 43)}…` : text, bx + w / 2, by + h / 2 + 1);
}

export type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };

export function stepParticles(ps: Particle[], dt: number) {
  for (const p of ps) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 380 * dt;
    p.life -= dt;
  }
  for (let i = ps.length - 1; i >= 0; i--) if (ps[i]!.life <= 0) ps.splice(i, 1);
}

export function drawParticles(ctx: CanvasRenderingContext2D, ps: Particle[]) {
  for (const p of ps) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size * 0.6);
  }
  ctx.globalAlpha = 1;
}

export function drawTrail(ctx: CanvasRenderingContext2D, trail: { x: number; y: number; color: string }[]) {
  if (trail.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineWidth = 6;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]!, b = trail[i]!;
    ctx.globalAlpha = 0.15 + 0.55 * (i / trail.length);
    ctx.strokeStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
