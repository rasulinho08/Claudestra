// The office floor (docs/17): every agent is a person with a desk. They walk to the bookshelf to read files, to the
// web terminal to search, to the server rack to run commands, type at their desk to write, and wait at the boss's
// office when they need your approval. Envelopes fly when work is handed out and handed back.
import { useEffect, useRef } from "react";
import {
  PAL, drawBoard, drawChair, drawClock, drawCoffee, drawDesk, drawEnvelope, drawGlobeDesk, drawMeetingTable, drawPerson, drawPlant, drawPoster, drawPrinter, drawRug,
  drawServer, drawShelf, drawSofa, drawWaterCooler, drawWindow, lookFor, skyFor,
} from "./art.ts";
import { CORRIDOR_Y, OfficeSim, seatOf, type Layout, type WorkStatus } from "./floor.ts";

export type FloorWorker = { id: string; name: string; color: string; isBoss: boolean; status: WorkStatus; tool: string | null; label: string | null; meeting?: boolean };

type Props = {
  workers: FloorWorker[];
  board: [number, number, number];
  // Called with the person's id and where they are on the page (for a popover), or null for empty floor.
  onPick?: (id: string | null, at: { x: number; y: number }) => void;
  selected?: string | null;
  ariaLabel: string;
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function drawRooms(ctx: CanvasRenderingContext2D, L: Layout, t: number, now: Date, board: [number, number, number], busy: { server: boolean; web: boolean }) {
  const hour = now.getHours();
  // desk area: wooden planks
  for (let y = L.roomsBottom; y < L.h; y += 8) {
    ctx.fillStyle = (y / 8) % 2 === 0 ? PAL.plankA : PAL.plankB;
    ctx.fillRect(0, y, L.w, 8);
    ctx.fillStyle = PAL.plankLine;
    ctx.fillRect(0, y + 7, L.w, 1);
    for (let x = ((y / 8) % 3) * 22; x < L.w; x += 66) ctx.fillRect(x, y, 1, 7);
  }
  // corridor: tiles
  for (let x = 0; x < L.w; x += 12) {
    ctx.fillStyle = (x / 12) % 2 === 0 ? PAL.corridorA : PAL.corridorB;
    ctx.fillRect(x, L.roomsBottom, 12, CORRIDOR_Y + 12 - L.roomsBottom);
  }
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.fillRect(0, CORRIDOR_Y + 12, L.w, 2);
  // rooms: carpets
  const carpet = (r: [number, number], c: string, stripe: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(r[0], 22, r[1] - r[0], L.roomsBottom - 22);
    ctx.fillStyle = stripe;
    for (let y = 26; y < L.roomsBottom; y += 6) ctx.fillRect(r[0], y, r[1] - r[0], 1);
  };
  carpet(L.rooms.boss, PAL.carpetBoss, "rgba(255,255,255,.05)");
  carpet(L.rooms.meet, PAL.carpetMeet, "rgba(255,255,255,.05)");
  carpet(L.rooms.lab, PAL.carpetLab, "rgba(255,255,255,.05)");
  carpet(L.rooms.kitchen, PAL.carpetKitchen, "rgba(0,0,0,.06)");
  for (let x = L.rooms.kitchen[0]; x < L.rooms.kitchen[1]; x += 10) {
    ctx.fillStyle = "rgba(0,0,0,.06)";
    ctx.fillRect(x, 22, 1, L.roomsBottom - 22);
  }
  drawRug(ctx, 22, 60, 78, 40, "#7b4a7f");
  // back wall
  ctx.fillStyle = PAL.wallTop;
  ctx.fillRect(0, 0, L.w, 3);
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(0, 3, L.w, 15);
  ctx.fillStyle = PAL.wallLow;
  ctx.fillRect(0, 18, L.w, 3);
  ctx.fillStyle = PAL.wallDark;
  ctx.fillRect(0, 21, L.w, 2);
  for (const x of [14, 84, 250, 400, 536]) drawWindow(ctx, x, 3, t, hour);
  drawPoster(ctx, 52, 4, 0);
  drawBoard(ctx, 172, 1, board);
  drawClock(ctx, 238, 5, now);
  drawPoster(ctx, 372, 4, 1);
  drawPoster(ctx, 512, 4, 2);
  // partitions between rooms, open towards the corridor
  for (const x of [124, 290, 440]) {
    ctx.fillStyle = PAL.wallDark;
    ctx.fillRect(x - 1, 21, 8, 62);
    ctx.fillStyle = PAL.wall;
    ctx.fillRect(x, 21, 6, 60);
    ctx.fillStyle = PAL.wallTop;
    ctx.fillRect(x, 21, 6, 3);
    ctx.fillStyle = "rgba(0,0,0,.2)";
    ctx.fillRect(x + 6, 24, 2, 58);
  }
  // furniture of the shared rooms
  drawMeetingTable(ctx, 184, 50, 84);
  drawShelf(ctx, 302, 25, 62);
  drawGlobeDesk(ctx, 384, 50, t, busy.web);
  drawPrinter(ctx, 416, 30, t, false);
  drawServer(ctx, 450, 27, t, busy.server);
  drawCoffee(ctx, 494, 40, t);
  drawWaterCooler(ctx, 556, 40, t);
  drawSofa(ctx, 534, 88);
  drawPlant(ctx, 14, 44, true);
  drawPlant(ctx, 114, 100);
  drawPlant(ctx, 280, 44, true);
  drawPlant(ctx, 432, 100);
  drawPlant(ctx, 10, L.h - 6, true);
  drawPlant(ctx, L.w - 10, L.h - 6, true);
  // outer walls
  ctx.fillStyle = PAL.wallDark;
  ctx.fillRect(0, 0, 3, L.h);
  ctx.fillRect(L.w - 3, 0, 3, L.h);
  ctx.fillRect(0, L.h - 3, L.w, 3);
}

function bubble(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, accent: string | null, maxW: number, limitW: number) {
  ctx.font = "600 11.5px Inter, system-ui, sans-serif";
  let label = text;
  while (label.length > 4 && ctx.measureText(label).width > maxW - 16) label = `${label.slice(0, -2)}…`;
  const w = Math.ceil(ctx.measureText(label).width) + 14;
  const x = Math.round(Math.max(4, Math.min(limitW - w - 4, cx - w / 2)));
  const y = Math.round(top - 22);
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 2, w, 18, 6);
  ctx.fill();
  ctx.fillStyle = accent ?? "#ffffff";
  ctx.strokeStyle = "#141a2b";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 18, 6);
  ctx.fill();
  ctx.stroke();
  // tail
  const tx = Math.max(x + 8, Math.min(x + w - 8, cx));
  ctx.beginPath();
  ctx.moveTo(tx - 4, y + 17.3);
  ctx.lineTo(tx, y + 23);
  ctx.lineTo(tx + 4, y + 17.3);
  ctx.fillStyle = accent ?? "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tx - 4, y + 18);
  ctx.lineTo(tx, y + 23);
  ctx.lineTo(tx + 4, y + 18);
  ctx.stroke();
  ctx.fillStyle = "#111827";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 7, y + 9.5);
}

export function OfficeFloor({ workers, board, onPick, selected, ariaLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const data = useRef({ workers, board, selected });
  data.current = { workers, board, selected };
  const sim = useRef<OfficeSim | null>(null);
  const scaleRef = useRef(1);
  const hover = useRef<{ x: number; y: number } | null>(null);

  const personAt = (x: number, y: number): string | null => {
    const s = sim.current;
    if (!s) return null;
    let best: string | null = null;
    let bestD = 16;
    for (const a of s.actors.values()) {
      const d = Math.hypot(a.pos.x - x, a.pos.y - 11 - y);
      if (d < bestD) (bestD = d), (best = a.id);
    }
    return best;
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const s = (sim.current = new OfficeSim(reducedMotion()));
    let raf = 0;
    let last = performance.now();
    let width = wrap.clientWidth;
    let height = wrap.clientHeight;
    const ro = new ResizeObserver(() => ((width = wrap.clientWidth), (height = wrap.clientHeight)));
    ro.observe(wrap);

    const frame = (nowMs: number) => {
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;
      const now = new Date();
      const { workers: ws, board: counts, selected: sel } = data.current;
      s.sync(ws, nowMs);
      s.step(dt, nowMs);
      const L = s.layout;
      // Fit the width (and the height in full screen); on very wide screens snap to half steps for crisp pixels.
      const full = document.fullscreenElement !== null;
      const fit = Math.max(0.4, Math.min((width - 18) / L.w, full ? (height - 18) / L.h : 99));
      const scale = Math.min(4, fit >= 2 ? Math.floor(fit * 2) / 2 : fit);
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
      drawRooms(ctx, L, t, now, counts, { server: at("server"), web: at("web") });

      const staff = ws.filter((w) => !w.isBoss);
      const boss = ws.find((w) => w.isBoss);
      const glowFor = (w: FloorWorker | undefined) => {
        const a = w && s.actors.get(w.id);
        return w && a && s.seated(a) && w.status === "working" ? w.color : null;
      };
      const seatedAt = new Set<string>();
      for (const a of s.actors.values()) if (s.seated(a)) seatedAt.add(a.id);

      // desks, then empty chairs
      drawDesk(ctx, L.bossDesk.x, L.bossDesk.y, glowFor(boss), t, 2, true);
      staff.forEach((w, i) => drawDesk(ctx, L.desks[i]!.x, L.desks[i]!.y, glowFor(w), t, i));
      const bossSeat = seatOf(L.bossDesk);
      if (!boss || !seatedAt.has(boss.id)) drawChair(ctx, bossSeat.x, bossSeat.y, "#8a6a35");
      staff.forEach((w, i) => {
        const seat = seatOf(L.desks[i]!);
        if (!seatedAt.has(w.id)) drawChair(ctx, seat.x, seat.y);
      });

      // people, back to front; a seated person gets the chair back drawn over them
      const hoverId = hover.current ? personAt(hover.current.x, hover.current.y) : null;
      const actors = [...s.actors.values()].sort((a, b) => a.pos.y - b.pos.y);
      for (const a of actors) {
        const w = byId.get(a.id);
        if (!w) continue;
        const seated = s.seated(a);
        if (a.id === sel || a.id === hoverId) {
          ctx.strokeStyle = a.id === sel ? "#fbbf24" : "rgba(255,255,255,.8)";
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(a.pos.x) - 8.5, Math.round(a.pos.y) - 25.5 + (seated ? 5 : 0), 17, seated ? 22 : 27);
        }
        drawPerson(ctx, a.pos.x, a.pos.y, lookFor(w.id, w.color), { facing: seated ? "up" : a.path.length ? a.facing : a.place === "coffee" ? "down" : a.place === "boss" ? "left" : "up", walking: a.path.length > 0, seated, typing: seated && w.status === "working", t: t + (hashPhase(a.id) % 7) });
        if (seated) drawChair(ctx, a.pos.x, a.pos.y, w.isBoss ? "#8a6a35" : "#465173", true);
      }
      for (const e of s.envelopes) {
        const k = Math.min(1, (nowMs - e.start) / e.duration);
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        drawEnvelope(ctx, e.from.x + (e.to.x - e.from.x) * ease, e.from.y + (e.to.y - e.from.y) * ease - 24 - Math.sin(k * Math.PI) * 28);
      }
      // evening light
      if (skyFor(now.getHours()).night) {
        ctx.fillStyle = "rgba(12,16,48,.20)";
        ctx.fillRect(0, 0, L.w, L.h);
      }

      // text is drawn at screen resolution so it stays sharp
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "left";
      const small = scale < 1.25;
      for (const a of actors) {
        const w = byId.get(a.id);
        if (!w) continue;
        ctx.font = `600 ${small ? 9 : 11}px Inter, system-ui, sans-serif`;
        const first = w.name.split(" ")[0]!.slice(0, 12);
        const nw = ctx.measureText(first).width + 10;
        const nx = Math.round(a.home.x * scale - nw / 2);
        const ny = Math.round((a.home.y + 4) * scale);
        const nh = small ? 13 : 16;
        ctx.fillStyle = "rgba(15,20,36,.88)";
        ctx.beginPath();
        ctx.roundRect(nx, ny, nw, nh, 4);
        ctx.fill();
        if (w.status !== "idle") {
          ctx.fillStyle = w.status === "waiting" ? "#fbbf24" : "#4ade80";
          ctx.beginPath();
          ctx.roundRect(nx, ny, 3, nh, [4, 0, 0, 4]);
          ctx.fill();
        }
        ctx.fillStyle = w.status === "idle" ? "#d5dbea" : "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(first, nx + 6, ny + nh / 2 + 0.5);
      }
      for (const a of actors) {
        const w = byId.get(a.id);
        if (!w || w.status === "idle" || !w.label) continue;
        const sx = a.pos.x * scale;
        const sy = (a.pos.y - (s.seated(a) ? 19 : 25)) * scale;
        if (small) {
          ctx.fillStyle = w.status === "waiting" ? "#fbbf24" : "#4ade80";
          ctx.beginPath();
          ctx.arc(sx, sy - 5, 3.5, 0, Math.PI * 2);
          ctx.fill();
        } else bubble(ctx, w.label, sx, sy - 2, w.status === "waiting" ? "#fbbf24" : null, 200, cssW);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toWorld = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scaleRef.current, y: (e.clientY - rect.top) / scaleRef.current };
  };

  return (
    <div className="office-floor" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => {
          hover.current = toWorld(e);
          e.currentTarget.style.cursor = personAt(hover.current.x, hover.current.y) ? "pointer" : "default";
        }}
        onMouseLeave={() => (hover.current = null)}
        onClick={(e) => {
          const p = toWorld(e);
          onPick?.(personAt(p.x, p.y), { x: e.clientX, y: e.clientY });
        }}
      />
    </div>
  );
}

function hashPhase(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
