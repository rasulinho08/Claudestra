// The office floor (docs/17): every agent is a person with a desk. They walk to the bookshelf to read files, to the
// web terminal to search, to the server rack to run commands, type at their desk to write, and wait at the boss's
// office when they need your approval. Envelopes fly when work is handed out and handed back.
import { useEffect, useRef } from "react";
import { PAL, drawBoard, drawChair, drawCoffee, drawDesk, drawEnvelope, drawGlobeDesk, drawMeetingTable, drawPerson, drawPlant, drawServer, drawShelf, drawWindow, lookFor } from "./art.ts";
import { CORRIDOR_Y, OfficeSim, type Layout, type WorkStatus } from "./floor.ts";

export type FloorWorker = { id: string; name: string; color: string; isBoss: boolean; status: WorkStatus; tool: string | null; label: string | null };

type Props = { workers: FloorWorker[]; board: [number, number, number]; onPick?: (id: string) => void; ariaLabel: string };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function drawRooms(ctx: CanvasRenderingContext2D, L: Layout, t: number, board: [number, number, number], serverBusy: boolean, webBusy: boolean) {
  // floor tiles
  for (let y = 0; y < L.h; y += 16) for (let x = 0; x < L.w; x += 16) {
    ctx.fillStyle = ((x + y) / 16) % 2 === 0 ? PAL.floorA : PAL.floorB;
    ctx.fillRect(x, y, 16, 16);
  }
  const carpet = (r: [number, number], c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(r[0], 18, r[1] - r[0], L.roomsBottom - 18);
    ctx.fillStyle = "rgba(255,255,255,.04)";
    for (let y = 22; y < L.roomsBottom; y += 8) ctx.fillRect(r[0], y, r[1] - r[0], 1);
  };
  carpet(L.rooms.boss, PAL.carpetBoss);
  carpet(L.rooms.meet, PAL.carpetMeet);
  carpet(L.rooms.lab, PAL.carpetLab);
  carpet(L.rooms.kitchen, PAL.carpetKitchen);
  // back wall with windows
  ctx.fillStyle = PAL.wallTop;
  ctx.fillRect(0, 0, L.w, 4);
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(0, 4, L.w, 14);
  ctx.fillStyle = PAL.wallDark;
  ctx.fillRect(0, 18, L.w, 2);
  for (const x of [20, 96, 178, 600, 676]) drawWindow(ctx, x, 3, t);
  // partitions between rooms (open towards the corridor)
  for (const x of [152, 362, 564]) {
    ctx.fillStyle = PAL.wall;
    ctx.fillRect(x, 18, 6, 62);
    ctx.fillStyle = PAL.wallTop;
    ctx.fillRect(x, 18, 6, 3);
    ctx.fillStyle = PAL.wallDark;
    ctx.fillRect(x, 78, 6, 2);
  }
  // outer walls
  ctx.fillStyle = PAL.wallDark;
  ctx.fillRect(0, 0, 4, L.h);
  ctx.fillRect(L.w - 4, 0, 4, L.h);
  ctx.fillRect(0, L.h - 4, L.w, 4);
  // furniture of the shared rooms
  drawMeetingTable(ctx, 196, 50, 112);
  drawBoard(ctx, 280, 0, board);
  drawShelf(ctx, 376, 22, 64);
  drawGlobeDesk(ctx, 490, 44, t, webBusy);
  drawServer(ctx, 580, 24, t, serverBusy);
  drawCoffee(ctx, 644, 38, t);
  drawPlant(ctx, 20, 40);
  drawPlant(ctx, 346, 40);
  drawPlant(ctx, 552, 40);
  drawPlant(ctx, 700, 100);
  drawPlant(ctx, 14, L.h - 8);
  drawPlant(ctx, L.w - 14, L.h - 8);
  // a strip of darker tiles marks the corridor
  ctx.fillStyle = "rgba(0,0,0,.10)";
  ctx.fillRect(4, CORRIDOR_Y - 10, L.w - 8, 20);
}

function bubble(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, accent: string | null, maxW: number) {
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  let label = text;
  while (label.length > 4 && ctx.measureText(label).width > maxW - 14) label = `${label.slice(0, -2)}…`;
  const w = Math.ceil(ctx.measureText(label).width) + 12;
  const x = Math.round(cx - w / 2);
  const y = Math.round(top - 18);
  ctx.fillStyle = accent ?? "#f8fafc";
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 16, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accent ? "#111" : "#0f172a";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 6, y + 8.5);
}

export function OfficeFloor({ workers, board, onPick, ariaLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const data = useRef({ workers, board });
  data.current = { workers, board };
  const sim = useRef<OfficeSim | null>(null);
  const scaleRef = useRef(1);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const s = (sim.current = new OfficeSim(reducedMotion()));
    let raf = 0;
    let last = performance.now();
    let width = wrap.clientWidth;
    const ro = new ResizeObserver(() => (width = wrap.clientWidth));
    ro.observe(wrap);

    const frame = (nowMs: number) => {
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;
      const { workers: ws, board: counts } = data.current;
      s.sync(ws, nowMs);
      s.step(dt, nowMs);
      const L = s.layout;
      // Fit the width; on very wide screens snap to half steps so the pixels stay crisp.
      const fit = Math.max(0.4, (width - 18) / L.w);
      const scale = Math.min(3, fit >= 2 ? Math.floor(fit * 2) / 2 : fit);
      scaleRef.current = scale;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const cssW = Math.round(L.w * scale);
      const cssH = Math.round(L.h * scale);
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const byId = new Map(ws.map((w) => [w.id, w]));
      const at = (place: string) => [...s.actors.values()].some((a) => a.place === place && a.path.length === 0 && a.status === "working");
      drawRooms(ctx, L, t, counts, at("server"), at("web"));

      // desks (and the boss's desk) with their chairs
      const staff = ws.filter((w) => !w.isBoss);
      const boss = ws.find((w) => w.isBoss);
      const deskOf = (i: number) => L.desks[i]!;
      const glowFor = (w: FloorWorker | undefined) => {
        const a = w && s.actors.get(w.id);
        return w && a && s.seated(a) && w.status === "working" ? w.color : null;
      };
      drawDesk(ctx, L.bossDesk.x, L.bossDesk.y, glowFor(boss), t, 2);
      staff.forEach((w, i) => drawDesk(ctx, deskOf(i).x, deskOf(i).y, glowFor(w), t, i));
      drawChair(ctx, L.bossDesk.x + 15, L.bossDesk.y + 31, "#7a5a2e");
      staff.forEach((_, i) => drawChair(ctx, deskOf(i).x + 15, deskOf(i).y + 31));

      // people, back to front
      const actors = [...s.actors.values()].sort((a, b) => a.pos.y - b.pos.y);
      for (const a of actors) {
        const w = byId.get(a.id);
        if (!w) continue;
        const seated = s.seated(a);
        drawPerson(ctx, a.pos.x, a.pos.y, lookFor(w.id, w.color), { facing: seated ? "up" : a.facing, walking: a.path.length > 0, seated, typing: seated && w.status === "working", t: t + (a.pos.x % 7) });
      }
      for (const e of s.envelopes) {
        const k = Math.min(1, (nowMs - e.start) / e.duration);
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        drawEnvelope(ctx, e.from.x + (e.to.x - e.from.x) * ease, e.from.y + (e.to.y - e.from.y) * ease - 22 - Math.sin(k * Math.PI) * 26);
      }

      // text is drawn at screen resolution so it stays sharp
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "left";
      const small = scale < 1.2;
      for (const a of actors) {
        const w = byId.get(a.id);
        if (!w) continue;
        const sx = a.pos.x * scale;
        const sy = a.pos.y * scale;
        // name plate under the seat
        ctx.font = `600 ${small ? 9 : 10.5}px Inter, system-ui, sans-serif`;
        const first = w.name.split(" ")[0]!.slice(0, 12);
        const nw = ctx.measureText(first).width + 8;
        const nx = a.home.x * scale - nw / 2;
        const ny = (a.home.y + 3) * scale;
        ctx.fillStyle = "rgba(11,16,32,.82)";
        ctx.beginPath();
        ctx.roundRect(nx, ny, nw, small ? 12 : 14, 3);
        ctx.fill();
        ctx.fillStyle = w.status === "idle" ? "#cbd5e1" : w.color;
        ctx.textBaseline = "middle";
        ctx.fillText(first, nx + 4, ny + (small ? 6.5 : 7.5));
        if (w.label && w.status !== "idle" && !small) bubble(ctx, w.label, sx, sy - 22 * scale, w.status === "waiting" ? "#fbbf24" : null, 190);
        else if (w.status !== "idle" && small) {
          ctx.fillStyle = w.status === "waiting" ? "#fbbf24" : "#4ade80";
          ctx.beginPath();
          ctx.arc(sx, sy - 24 * scale, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  function pick(e: React.MouseEvent<HTMLCanvasElement>) {
    const s = sim.current;
    if (!s || !onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scaleRef.current;
    const y = (e.clientY - rect.top) / scaleRef.current;
    let best: string | null = null;
    let bestD = 20;
    for (const a of s.actors.values()) {
      const d = Math.hypot(a.pos.x - x, a.pos.y - 10 - y);
      if (d < bestD) (bestD = d), (best = a.id);
    }
    if (best) onPick(best);
  }

  return (
    <div className="office-floor" ref={wrapRef}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} onClick={pick} />
    </div>
  );
}
