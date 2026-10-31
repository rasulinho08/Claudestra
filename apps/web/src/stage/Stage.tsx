import { useEffect, useRef } from "react";
import type { RunView } from "../run-state.ts";
import { agentFor } from "../graph.ts";
import { t, type Key } from "../i18n.ts";
import { usd } from "../format.ts";
import { UNIT, drawBackground, drawBubble, drawParticles, drawRobot, drawStation, drawTrail, stepParticles, type Particle, type Theme } from "./draw.ts";
import { Director, FINISH, HQ, WORLD_W, layoutFor, pointAt, stationKeyOf, toolLine, worldHeightFor, type Layout, type Trip } from "./world.ts";

type Props = { run: RunView; transparent?: boolean; hud?: boolean; fps?: number; theme?: "dark" | "light" };

type Robot = {
  dist: number;
  target: number;
  trip: Trip | null;
  phase: "idle" | "toFrom" | "pickup" | "toTarget";
  wait: number;
  carrying: string | null;
  hopPhase: number;
  facing: 1 | -1;
  at: string;
  blinkIn: number;
  happyFor: number;
};

const SPEED = 260; // world px per second
const HOP_LENGTH = 48; // px of road per hop
const MAX_DPR = 1.5;
// The robot stands just past a desk (before it at the road's end) so it never hides the desk.
const STAND_OFFSET = 62;

// Animated "stage" view (docs/13): a little Strativu robot hops along a road between agent desks,
// carrying each handoff. Canvas 2D, capped frame rate, background cached, so it is cheap to leave open.
export function Stage({ run, transparent = false, hud = true, fps = 30, theme }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const bg = document.createElement("canvas");
    const bgCtx = bg.getContext("2d")!;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    const look = (): Theme => ({ dark: theme ? theme === "dark" : (darkQuery?.matches ?? true), transparent });
    let themeNow = look();

    let layout: Layout | null = null;
    let bgKey = "";
    let scale = 1, offX = 0, offY = 0, dpr = 1, worldH = 720;
    let director = new Director();
    let lastSeq = -1;
    const robot: Robot = { dist: 0, target: 0, trip: null, phase: "idle", wait: 0, carrying: null, hopPhase: 0, facing: 1, at: HQ, blinkIn: 2, happyFor: 0 };
    const particles: Particle[] = [];
    const trail: { x: number; y: number; color: string }[] = [];
    let lastTrail = { x: -999, y: -999 };

    const resize = () => {
      const rect = host.current!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      worldH = worldHeightFor(canvas.width, canvas.height);
      scale = Math.min(canvas.width / WORLD_W, canvas.height / worldH);
      offX = (canvas.width - WORLD_W * scale) / 2;
      offY = (canvas.height - worldH * scale) / 2;
      // Force a layout pass for the new world height (not a replay reset).
      layout = layout ? { ...layout, key: "" } : null;
      bg.width = canvas.width;
      bg.height = canvas.height;
      bgKey = "";
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current!);
    resize();
    const onTheme = () => {
      themeNow = look();
      bgKey = "";
    };
    darkQuery?.addEventListener?.("change", onTheme);

    const burst = (x: number, y: number, colors: string[], n: number, power = 260) => {
      if (reduced) return;
      for (let i = 0; i < n && particles.length < 140; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = power * (0.4 + Math.random() * 0.6);
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.6, life: 0.8 + Math.random() * 0.8, color: colors[i % colors.length]!, size: 4 + Math.random() * 4 });
      }
    };

    const syncRun = () => {
      const r = runRef.current;
      if (r.lastSeq === lastSeq && layout) return;
      // A replay jumping back: start the choreography over. (A different run remounts the component.)
      if (r.lastSeq < lastSeq) {
        director = new Director();
        robot.trip = null;
        robot.phase = "idle";
        robot.carrying = null;
        trail.length = 0;
        layout = null;
      }
      lastSeq = r.lastSeq;
      const next = layoutFor(r, (id) => agentFor(r, id), worldH);
      if (!layout || next.key !== layout.key) {
        // Keep the robot at the same station when desks are added.
        const oldAt = robot.at;
        layout = next;
        robot.dist = robot.target = standAt(layout.byKey.has(oldAt) ? oldAt : HQ) ?? 0;
        trail.length = 0;
      }
      const initial = director.sync(r, (key) => layout!.byKey.get(key)?.color ?? "#43d0ff");
      if (initial) {
        robot.at = layout.byKey.has(initial) ? initial : HQ;
        robot.dist = robot.target = standAt(robot.at) ?? 0;
      }
    };

    const standAt = (key: string | undefined): number | undefined => {
      const st = key ? layout?.byKey.get(key) : undefined;
      if (!st || !layout) return undefined;
      return Math.max(0, Math.min(layout.road.length, st.dist + (st.key === FINISH ? -STAND_OFFSET : STAND_OFFSET)));
    };

    const update = (dt: number, t: number) => {
      if (!layout) return;
      const l = layout;
      // Next trip
      if (!robot.trip && director.queue.length > 0) {
        robot.trip = director.queue.shift()!;
        if (robot.trip.kind === "carry") {
          const fromDist = standAt(robot.trip.from);
          robot.phase = fromDist !== undefined && Math.abs(fromDist - robot.dist) > 4 ? "toFrom" : "pickup";
          robot.target = fromDist ?? robot.dist;
          robot.wait = 0.35;
        } else {
          robot.phase = "toTarget";
          robot.target = standAt(robot.trip.to) ?? robot.dist;
        }
      }
      const trip = robot.trip;
      if (robot.phase === "pickup") {
        robot.wait -= dt;
        if (robot.wait <= 0 && trip?.kind === "carry") {
          robot.carrying = trip.color;
          const from = l.byKey.get(trip.from);
          if (from) burst(from.pos.x, from.pos.y - 60, [trip.color, "#ffffff"], 10, 160);
          robot.phase = "toTarget";
          robot.target = standAt(trip.to) ?? robot.dist;
        }
      } else if (robot.phase === "toFrom" || robot.phase === "toTarget") {
        const delta = robot.target - robot.dist;
        const move = Math.sign(delta) * Math.min(Math.abs(delta), SPEED * dt);
        robot.dist += move;
        robot.hopPhase += Math.abs(move) / HOP_LENGTH;
        if (Math.abs(move) > 0.01) {
          const p = pointAt(l.road, robot.dist);
          const dirX = Math.cos(p.angle) * Math.sign(move);
          if (Math.abs(dirX) > 0.2) robot.facing = dirX > 0 ? 1 : -1;
          if (Math.hypot(p.x - lastTrail.x, p.y - lastTrail.y) > 8) {
            trail.push({ x: p.x, y: p.y + 2, color: robot.carrying ?? "#43d0ff" });
            if (trail.length > 420) trail.shift();
            lastTrail = p;
          }
        }
        if (Math.abs(robot.target - robot.dist) < 0.5) {
          robot.hopPhase = Math.round(robot.hopPhase);
          if (robot.phase === "toFrom") {
            robot.phase = "pickup";
            robot.wait = 0.35;
          } else {
            const to = trip ? l.byKey.get(trip.to) : undefined;
            if (to) {
              robot.at = to.key;
              if (robot.carrying) burst(to.pos.x, to.pos.y - 60, [robot.carrying, "#ffffff", to.color], 14, 200);
              if (to.key === FINISH && director.celebrate) {
                director.celebrate = false;
                robot.happyFor = 6;
                burst(to.pos.x, to.pos.y - 90, ["#f59e0b", "#43d0ff", "#22c55e", "#ef4444", "#a855f7"], 70, 380);
              }
            }
            robot.carrying = null;
            robot.phase = "idle";
            robot.trip = null;
          }
        }
      }
      robot.blinkIn -= dt;
      if (robot.blinkIn < -0.12) robot.blinkIn = 2 + Math.random() * 3;
      robot.happyFor = Math.max(0, robot.happyFor - dt);
      stepParticles(particles, dt);
      void t;
    };

    const bubbleText = (r: RunView): { text: string; accent?: string } | null => {
      if (r.status === "completed" && robot.at === FINISH && robot.phase === "idle") return { text: t("stage.done", { cost: usd(r.costUsd) }), accent: "#22c55e" };
      if (r.status === "failed") return { text: t("stage.wrong"), accent: "#ef4444" };
      if (r.status === "cancelled") return { text: t("stage.stopped") };
      if (r.paused) return { text: t("stage.paused"), accent: "#f59e0b" };
      if (r.pending.length > 0) return { text: t("stage.waiting"), accent: "#f59e0b" };
      if (robot.carrying && robot.trip?.kind === "carry") return { text: t("stage.delivering", { name: layout?.byKey.get(robot.trip.to)?.label ?? "…" }) };
      if (robot.phase !== "idle") return null;
      // Working at a desk: say what the agent there is doing.
      const here = r.order.filter((id) => stationKeyOf(r.steps[id], id) === robot.at && (r.steps[id]?.status === "running" || r.steps[id]?.status === "waiting_approval"));
      const step = here.length ? r.steps[here[here.length - 1]!] : undefined;
      if (!step) return r.status === "running" ? { text: "…" } : null;
      if (step.id === "ceo") return { text: step.lastTool === "StructuredOutput" ? t("stage.planReady") : t("stage.planning") };
      if (step.id === "final") return { text: t("stage.writingAnswer") };
      return { text: `${agentFor(r, step.agentId).name}: ${toolLine(step.lastTool)}`, accent: agentFor(r, step.agentId).color };
    };

    const render = (t: number) => {
      if (!layout) return;
      const r = runRef.current;
      const key = `${layout.key}|${canvas.width}x${canvas.height}|${themeNow.dark}|${themeNow.transparent}`;
      if (key !== bgKey) {
        bgCtx.setTransform(1, 0, 0, 1, 0, 0);
        bgCtx.clearRect(0, 0, bg.width, bg.height);
        bgCtx.setTransform(scale, 0, 0, scale, offX, offY);
        drawBackground(bgCtx, layout.road, themeNow, worldH);
        bgKey = key;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bg, 0, 0);
      ctx.setTransform(scale, 0, 0, scale, offX, offY);

      drawTrail(ctx, trail);
      for (const st of layout.stations) {
        const ids = r.order.filter((id) => stationKeyOf(r.steps[id], id) === st.key);
        const steps = ids.map((id) => r.steps[id]!).filter(Boolean);
        const latest = steps[steps.length - 1];
        const working = steps.some((s) => s.status === "running");
        const status = steps.some((s) => s.status === "waiting_approval") ? "waiting_approval" : (latest?.status ?? (st.key === FINISH && r.status === "completed" ? "succeeded" : "pending"));
        drawStation(ctx, st, { status, working, tool: latest?.lastTool }, t, themeNow);
      }

      const p = pointAt(layout.road, robot.dist);
      const moving = robot.phase === "toFrom" || robot.phase === "toTarget";
      const hopWave = Math.sin(robot.hopPhase * Math.PI);
      const hop = reduced ? 0 : moving ? Math.abs(hopWave) * 26 : robot.phase === "idle" && r.status === "running" ? Math.abs(Math.sin(t * 3)) * 3 : 0;
      const squash = moving && Math.abs(hopWave) < 0.18 ? 0.86 : 1;
      drawRobot(ctx, { x: p.x, y: p.y, hop, squash, facing: robot.facing, walking: moving, carrying: robot.carrying, blink: robot.blinkIn < 0, happy: robot.happyFor > 0 || r.status === "completed", t }, themeNow);
      const bubble = bubbleText(r);
      if (bubble) drawBubble(ctx, p.x, p.y - (140 + hop) * UNIT, bubble.text, themeNow, bubble.accent);
      drawParticles(ctx, particles);
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frameMs = 1000 / Math.max(5, Math.min(60, reduced ? Math.min(fps, 15) : fps));
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      acc += now - last;
      last = now;
      if (acc < frameMs) return;
      const dt = Math.min(acc, 100) / 1000;
      acc = 0;
      syncRun();
      update(dt, now / 1000);
      render(now / 1000);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      darkQuery?.removeEventListener?.("change", onTheme);
    };
  }, [transparent, fps, theme]);

  const active = run.order.map((id) => run.steps[id]!).filter((s) => s && (s.status === "running" || s.status === "waiting_approval"));
  return (
    <div ref={host} className={`stage ${transparent ? "stage-transparent" : ""}`}>
      <canvas ref={canvasRef} />
      {hud && (
        <div className="stage-hud">
          <div className="stage-title">
            <span className={`status status-${run.paused ? "paused" : run.status}`}>{t(`status.${run.paused ? "paused" : run.status}` as Key)}</span>
            <span className="stage-prompt">{run.prompt}</span>
          </div>
          <div className="stage-meta">
            {usd(run.costUsd) || "$0"}
            {active.length > 0 && ` · ${t("stage.working", { names: active.map((s) => agentFor(run, s.agentId).name).join(", ") })}`}
          </div>
        </div>
      )}
    </div>
  );
}
