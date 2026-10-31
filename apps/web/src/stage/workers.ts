// Desk workers on the stage: a small robot per agent that visibly does its job (researcher sweeps a magnifier,
// coder types on a laptop, designer paints, tester shakes a flask…). Plain fills and strokes, no images.
import type { Activity, Mood } from "./world.ts";

const NAVY = "#0b1a33";
const GLOW = "#7fe3ff";

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, w = 2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.stroke();
}

// Worker standing on (x, y). Activity props are drawn to its right, toward the desk.
export function drawWorker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, activity: Activity, mood: Mood, t: number, dark: boolean) {
  const working = mood === "working";
  ctx.save();
  ctx.globalAlpha = mood === "off" ? 0.4 : 1;

  // Body motion per activity.
  const bob = working ? Math.abs(Math.sin(t * (activity === "type" ? 14 : 6))) * (activity === "type" ? 1.2 : 2.2) : mood === "done" ? Math.abs(Math.sin(t * 2.2)) * 1.2 : 0;
  const lean = working && (activity === "read" || activity === "write" || activity === "type") ? 0.08 : 0;
  const by = y - bob;

  // Shadow
  ctx.fillStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(0,30,60,0.15)";
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 13, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, by);
  ctx.rotate(lean);

  // Legs
  ctx.fillStyle = "#8a98ad";
  rr(ctx, -7, -7, 5, 7, 2);
  ctx.fill();
  rr(ctx, 2, -7, 5, 7, 2);
  ctx.fill();

  // Body
  rr(ctx, -10, -23, 20, 17, 6);
  ctx.fillStyle = color;
  ctx.fill();
  rr(ctx, -5, -19, 10, 7, 3);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();

  // Arms: their pose depends on the activity.
  const armL = { x: -12, y: -20 };
  const armR = { x: 12, y: -20 };
  const handR = handFor(activity, mood, t, working);
  const handL = mood === "waiting" ? { x: -16, y: -44 } : working && activity === "type" ? { x: 8 + Math.sin(t * 22 + 1.5) * 2, y: -13 + Math.abs(Math.sin(t * 22 + 1.5)) * -2 } : { x: -15, y: -10 + Math.sin(t * 2) };
  line(ctx, armL.x, armL.y, handL.x, handL.y, color, 4);
  line(ctx, armR.x, armR.y, handR.x, handR.y, color, 4);
  dot(ctx, handL.x, handL.y, 2.6, NAVY);
  dot(ctx, handR.x, handR.y, 2.6, NAVY);

  // Head: white shell with the agent colour as rim, dark face screen.
  rr(ctx, -12, -43, 24, 19, 7);
  ctx.fillStyle = dark ? "#e9eef6" : "#ffffff";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  rr(ctx, -9, -39.5, 18, 11, 4);
  ctx.fillStyle = NAVY;
  ctx.fill();
  // Antenna that blinks while working.
  line(ctx, 0, -43, 0, -48, "#8a98ad", 1.5);
  dot(ctx, 0, -49.5, 2.4, working && Math.sin(t * 8) > 0 ? GLOW : color);

  // Eyes
  const look = mood === "idle" ? Math.sin(t * 0.9) * 2 : working && (activity === "type" || activity === "read" || activity === "write") ? 1.5 : 0;
  const eyeY = -34 + (working && (activity === "type" || activity === "write" || activity === "read") ? 1 : 0);
  ctx.strokeStyle = mood === "failed" ? "#ff8a8a" : GLOW;
  ctx.fillStyle = GLOW;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (const ex of [-4, 4]) {
    const cx = ex + look;
    ctx.beginPath();
    if (mood === "done") ctx.arc(cx, eyeY + 1.2, 2, Math.PI * 1.1, Math.PI * 1.9);
    else if (mood === "failed") {
      ctx.moveTo(cx - 1.6, eyeY - 1.6);
      ctx.lineTo(cx + 1.6, eyeY + 1.6);
      ctx.moveTo(cx + 1.6, eyeY - 1.6);
      ctx.lineTo(cx - 1.6, eyeY + 1.6);
    } else if (mood === "off" || (mood === "idle" && Math.sin(t * 0.7) > 0.96)) {
      ctx.moveTo(cx - 1.8, eyeY);
      ctx.lineTo(cx + 1.8, eyeY);
    } else {
      ctx.arc(cx, eyeY, 1.5, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.stroke();
  }
  ctx.restore();

  if (working) drawProp(ctx, x, y, color, activity, t, dark, handR, by);
  if (mood === "waiting") {
    // A raised hand and a blinking question mark: "I need your OK".
    const show = Math.floor(t * 2.5) % 2 === 0;
    ctx.font = "bold 15px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = show ? "#f59e0b" : "rgba(245,158,11,0.45)";
    ctx.fillText("?", x - 18, by - 54);
  }
  if (mood === "idle" && !working) {
    // Little "z" when nothing to do yet.
    ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = dark ? "rgba(255,255,255,0.45)" : "rgba(30,40,60,0.35)";
    const k = (t * 0.6) % 1;
    ctx.globalAlpha = 1 - k;
    ctx.fillText("z", x + 10 + k * 6, by - 48 - k * 10);
  }
  ctx.restore();
}

// Right-hand position for the activity (in worker-local coordinates).
function handFor(activity: Activity, mood: Mood, t: number, working: boolean): { x: number; y: number } {
  if (mood === "waiting") return { x: 15, y: -14 };
  if (!working) return { x: 15, y: -10 + Math.sin(t * 2 + 1) };
  switch (activity) {
    case "type":
      return { x: 12 + Math.sin(t * 22) * 2, y: -13 - Math.abs(Math.sin(t * 22)) * 2 };
    case "search":
      return { x: 17 + Math.cos(t * 2.4) * 4, y: -30 + Math.sin(t * 2.4) * 3 };
    case "paint":
      return { x: 21 + Math.sin(t * 5) * 3, y: -24 + Math.cos(t * 5) * 4 };
    case "write":
      return { x: 17 + ((t * 9) % 8), y: -12 };
    case "shout":
      return { x: 17, y: -32 };
    case "test":
      return { x: 17 + Math.sin(t * 16) * 2, y: -26 };
    case "review":
      return { x: 18, y: -18 - Math.max(0, Math.sin(t * 4)) * 8 };
    case "read":
      return { x: 14, y: -24 };
    default:
      return { x: 16, y: -20 + Math.sin(t * 3) * 2 };
  }
}

function drawProp(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, activity: Activity, t: number, dark: boolean, hand: { x: number; y: number }, by: number) {
  const hx = x + hand.x;
  const hy = by + hand.y;
  const ink = dark ? "#e6e8ee" : "#1b2433";
  ctx.save();
  switch (activity) {
    case "type": {
      // Laptop with scrolling code lines.
      rr(ctx, x + 6, y - 22, 26, 17, 3);
      ctx.fillStyle = NAVY;
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        const w = 6 + ((i * 7 + Math.floor(t * 6)) % 13);
        ctx.fillStyle = i % 2 ? GLOW : color;
        ctx.fillRect(x + 9 + (i % 2) * 3, y - 19 + i * 3.4, w, 1.6);
      }
      ctx.beginPath();
      ctx.moveTo(x + 3, y - 5);
      ctx.lineTo(x + 35, y - 5);
      ctx.lineTo(x + 32, y - 2);
      ctx.lineTo(x + 6, y - 2);
      ctx.closePath();
      ctx.fillStyle = "#9aa8bb";
      ctx.fill();
      // Little code sparks.
      const k = (t * 0.9) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.font = "bold 8px ui-monospace, monospace";
      ctx.fillStyle = color;
      ctx.fillText(Math.floor(t) % 2 ? "{ }" : "</>", x + 20, y - 26 - k * 12);
      break;
    }
    case "read": {
      // Open book held in front.
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      rr(ctx, hx - 2, hy - 9, 9, 12, 1.5);
      ctx.fill();
      ctx.stroke();
      rr(ctx, hx + 7, hy - 9, 9, 12, 1.5);
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = "#9aa8bb";
        ctx.fillRect(hx, hy - 6 + i * 3, 5, 1);
        ctx.fillRect(hx + 9, hy - 6 + i * 3, 5, 1);
      }
      break;
    }
    case "search": {
      // Magnifier sweeping, with a small globe of "results" behind.
      dot(ctx, x + 30, y - 40, 7, dark ? "#1d3a5c" : "#d9f2ff");
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x + 30, y - 40, 3, 7, 0, 0, Math.PI * 2);
      ctx.moveTo(x + 23, y - 40);
      ctx.lineTo(x + 37, y - 40);
      ctx.stroke();
      line(ctx, hx, hy, hx + 5, hy - 5, "#8a98ad", 2.5);
      ctx.beginPath();
      ctx.arc(hx + 8, hy - 8, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(127,227,255,0.35)";
      ctx.fill();
      ctx.strokeStyle = NAVY;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (Math.sin(t * 6) > 0.6) dot(ctx, hx + 6, hy - 10, 1.2, "#fff");
      break;
    }
    case "think":
    case "plan": {
      // Thought bubbles with dots (plan: a lightbulb idea).
      const k = (t * 1.2) % 1;
      dot(ctx, x + 10, by - 50 - k * 2, 1.6, dark ? "#cfd8e6" : "#ffffff");
      dot(ctx, x + 15, by - 56 - k * 2, 2.4, dark ? "#cfd8e6" : "#ffffff");
      rr(ctx, x + 14, by - 74, 24, 13, 6);
      ctx.fillStyle = dark ? "#cfd8e6" : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (activity === "plan") {
        dot(ctx, x + 26, by - 69, 3.2, Math.sin(t * 5) > 0 ? "#fbbf24" : "#fde68a");
        ctx.fillStyle = "#9aa8bb";
        ctx.fillRect(x + 24.5, by - 66, 3, 2);
      } else for (let i = 0; i < 3; i++) dot(ctx, x + 20 + i * 6, by - 67.5, 1.6, Math.floor(t * 3) % 3 === i ? color : "#9aa8bb");
      break;
    }
    case "paint": {
      // Easel with a canvas that fills with strokes; brush in hand.
      line(ctx, x + 22, y, x + 27, y - 32, "#a47148", 2);
      line(ctx, x + 38, y, x + 33, y - 32, "#a47148", 2);
      rr(ctx, x + 19, y - 36, 22, 18, 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#a47148";
      ctx.lineWidth = 1;
      ctx.stroke();
      const n = Math.floor(t * 2) % 5;
      const colors = [color, "#22c55e", "#f59e0b", "#3b82f6", "#ef4444"];
      for (let i = 0; i <= n; i++) {
        ctx.fillStyle = colors[i % colors.length]!;
        ctx.fillRect(x + 21 + (i % 3) * 6, y - 34 + Math.floor(i / 3) * 7, 5, 5);
      }
      line(ctx, hx, hy, hx + 4, hy - 6, "#a47148", 2);
      dot(ctx, hx + 4.5, hy - 7, 1.8, colors[n]!);
      break;
    }
    case "write": {
      // Paper on the desk, a line appearing under the pen.
      rr(ctx, x + 12, y - 15, 22, 13, 1.5);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#c3ccd8";
      ctx.lineWidth = 1;
      ctx.stroke();
      const prog = (t * 0.6) % 1;
      for (let i = 0; i < 3; i++) {
        const w = i < 2 ? 16 : 16 * prog;
        ctx.fillStyle = i < 2 ? "#9aa8bb" : color;
        ctx.fillRect(x + 15, y - 12 + i * 3.5, w, 1.3);
      }
      line(ctx, hx, hy, hx - 2, hy + 4, NAVY, 2);
      break;
    }
    case "translate": {
      // Letters turning from one alphabet into another.
      const pairs = [["A", "Ə"], ["Б", "B"], ["Ş", "S"], ["Я", "Ya"]];
      const i = Math.floor(t * 0.8) % pairs.length;
      const k = (t * 0.8) % 1;
      ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      rr(ctx, x + 12, by - 52, 15, 14, 4);
      ctx.fillStyle = dark ? "#cfd8e6" : "#ffffff";
      ctx.fill();
      rr(ctx, x + 32, by - 44, 15, 14, 4);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = NAVY;
      ctx.fillText(pairs[i]![0]!, x + 19.5, by - 44.5);
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.fillText(pairs[i]![1]!, x + 39.5, by - 36.5);
      ctx.globalAlpha = 1;
      line(ctx, x + 27, by - 46, x + 32, by - 40, "#9aa8bb", 1);
      break;
    }
    case "shout": {
      // Megaphone with sound waves.
      ctx.beginPath();
      ctx.moveTo(hx, hy - 2);
      ctx.lineTo(hx + 12, hy - 7);
      ctx.lineTo(hx + 12, hy + 5);
      ctx.lineTo(hx, hy + 2);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        const k = (t * 1.5 + i / 3) % 1;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        ctx.arc(hx + 12, hy - 1, 4 + k * 12, -0.6, 0.6);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "chart": {
      // Bars growing and shrinking on a small board.
      rr(ctx, x + 12, y - 30, 26, 24, 3);
      ctx.fillStyle = dark ? "#1b2440" : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#c3ccd8";
      ctx.lineWidth = 1;
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const h = 5 + (Math.sin(t * 2 + i * 1.3) * 0.5 + 0.5) * 13;
        ctx.fillStyle = i === 3 ? "#22c55e" : color;
        ctx.fillRect(x + 15 + i * 5.5, y - 9 - h, 4, h);
      }
      break;
    }
    case "test": {
      // Flask with rising bubbles.
      ctx.beginPath();
      ctx.moveTo(hx - 2, hy - 10);
      ctx.lineTo(hx + 2, hy - 10);
      ctx.lineTo(hx + 2, hy - 5);
      ctx.lineTo(hx + 7, hy + 4);
      ctx.lineTo(hx - 7, hy + 4);
      ctx.lineTo(hx - 2, hy - 5);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
      ctx.strokeStyle = NAVY;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(hx - 5, hy, 10, 3.5);
      for (let i = 0; i < 3; i++) {
        const k = (t * 1.4 + i / 3) % 1;
        ctx.globalAlpha = 1 - k;
        dot(ctx, hx + Math.sin(i * 2 + t * 3) * 2, hy - 10 - k * 14, 1.5 + i * 0.4, "#22c55e");
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "scan": {
      // Shield with a scanning line.
      const sx = x + 26;
      const sy = y - 28;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 11);
      ctx.lineTo(sx + 10, sy - 7);
      ctx.quadraticCurveTo(sx + 9, sy + 7, sx, sy + 12);
      ctx.quadraticCurveTo(sx - 9, sy + 7, sx - 10, sy - 7);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      const k = Math.sin(t * 3) * 9;
      line(ctx, sx - 14, sy + k, sx + 14, sy + k, GLOW, 1.5);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("✓", sx, sy + 3);
      break;
    }
    case "review": {
      // Clipboard where ticks appear one by one; the hand stamps.
      rr(ctx, x + 14, y - 30, 18, 24, 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#c3ccd8";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#9aa8bb";
      ctx.fillRect(x + 19, y - 32, 8, 3);
      const n = Math.floor(t * 1.5) % 4;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = "#c3ccd8";
        ctx.fillRect(x + 22, y - 24 + i * 6, 8, 1.5);
        if (i < n) {
          ctx.strokeStyle = "#22c55e";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x + 16, y - 24 + i * 6);
          ctx.lineTo(x + 17.5, y - 22.5 + i * 6);
          ctx.lineTo(x + 20, y - 26 + i * 6);
          ctx.stroke();
        }
      }
      break;
    }
    case "blueprint": {
      // Blue sheet with lines being drawn.
      rr(ctx, x + 12, y - 30, 26, 20, 2);
      ctx.fillStyle = "#1e4fa3";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 0.6;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 12 + i * 6.5, y - 30);
        ctx.lineTo(x + 12 + i * 6.5, y - 10);
        ctx.stroke();
      }
      const k = (t * 0.5) % 1;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 16, y - 26, 10 * Math.min(1, k * 2), 8);
      if (k > 0.5) {
        ctx.beginPath();
        ctx.moveTo(x + 26, y - 22);
        ctx.lineTo(x + 26 + 8 * (k - 0.5) * 2, y - 22);
        ctx.stroke();
      }
      break;
    }
    case "skill": {
      // A glowing book with sparkles: loading a skill.
      rr(ctx, hx - 4, hy - 8, 14, 11, 2);
      ctx.fillStyle = color;
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        const a = t * 3 + i * 1.6;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(a * 2);
        dot(ctx, hx + 3 + Math.cos(a) * 11, hy - 3 + Math.sin(a) * 8, 1.3, "#fbbf24");
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "call": {
      // Antenna waves: talking to an app.
      for (let i = 0; i < 3; i++) {
        const k = (t * 1.2 + i / 3) % 1;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        ctx.arc(x, by - 50, 4 + k * 12, -Math.PI * 0.8, -Math.PI * 0.2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
  }
  void ink;
  ctx.restore();
}
