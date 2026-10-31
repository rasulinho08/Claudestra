// Builds the canvas graph (nodes = steps, edges = dependencies/handoffs) from a RunView.
import { Graph, layout } from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { CEO_FINAL_STEP, CEO_PLAN_STEP, type AgentInfo } from "@claudestra/protocol";
import type { RunView, StepView } from "./run-state.ts";
import { agentName } from "./i18n.ts";

export const NODE_WIDTH = 230;
export const NODE_HEIGHT = 104;

export type StepNodeData = { step: StepView; agent: AgentInfo; selected: boolean; direction: "LR" | "TB" };
export type StepNode = Node<StepNodeData, "step">;

const FALLBACK_AGENT = (id: string): AgentInfo => ({ id, name: id === "claude-code" ? "Claude Code" : id, description: "", color: "#8a92a6", icon: "bot", modelClass: "mid" });

export function agentFor(run: RunView, agentId: string): AgentInfo {
  const info = run.agents[agentId] ?? FALLBACK_AGENT(agentId);
  const name = agentName(agentId, info.name);
  return name === info.name ? info : { ...info, name };
}

function edgeList(run: RunView): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const plan = run.plan;
  if (plan) {
    // Plan steps plus steps added during the run (verifier loop iterations).
    const deps = new Map<string, string[]>(plan.steps.map((s) => [s.id, s.dependsOn]));
    for (const step of Object.values(run.steps)) if (step.dependsOn) deps.set(step.id, step.dependsOn);
    const dependedOn = new Set([...deps.values()].flat());
    for (const [id, ds] of deps) {
      if (ds.length === 0) edges.push({ from: CEO_PLAN_STEP, to: id });
      for (const dep of ds) edges.push({ from: dep, to: id });
    }
    if (run.steps[CEO_FINAL_STEP]) {
      for (const id of deps.keys()) if (!dependedOn.has(id)) edges.push({ from: id, to: CEO_FINAL_STEP });
    }
    return edges;
  }
  // No plan (observer sessions): chain steps in the order they appeared.
  for (let i = 1; i < run.order.length; i++) edges.push({ from: run.order[i - 1]!, to: run.order[i]! });
  return edges;
}

export type Direction = "LR" | "TB";

function layoutGraph(order: string[], pairs: Array<{ from: string; to: string }>, rankdir: Direction) {
  const g = new Graph();
  g.setGraph({ rankdir, nodesep: rankdir === "LR" ? 28 : 36, ranksep: rankdir === "LR" ? 64 : 48, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of order) g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of pairs) g.setEdge(e.from, e.to);
  layout(g);
  const { width = 1, height = 1 } = g.graph() as { width?: number; height?: number };
  return { g, width, height };
}

// Lays the graph out left→right or top→bottom, whichever lets it be drawn larger in the container.
export function buildGraph(run: RunView, selectedId: string | null, container?: { width: number; height: number }) {
  const pairs = edgeList(run).filter((e) => run.steps[e.from] && run.steps[e.to]);
  let best = layoutGraph(run.order, pairs, "LR");
  let direction: Direction = "LR";
  if (container && container.width > 0 && container.height > 0) {
    const scale = (l: { width: number; height: number }) => Math.min(container.width / l.width, container.height / l.height);
    const tb = layoutGraph(run.order, pairs, "TB");
    if (scale(tb) > scale(best) * 1.1) {
      best = tb;
      direction = "TB";
    }
  }
  const { g } = best;

  const nodes: StepNode[] = run.order.map((id) => {
    const step = run.steps[id]!;
    const pos = g.node(id) as { x: number; y: number };
    return {
      id,
      type: "step",
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { step, agent: agentFor(run, step.agentId), selected: id === selectedId, direction },
      // Fixed size: no measuring pass, so fitView and the minimap are right from the first render.
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
    };
  });

  const handedOff = new Set(run.handoffs.map((h) => `${h.from}->${h.to}`));
  const edges: Edge[] = pairs.map(({ from, to }) => {
    const source = run.steps[from]!;
    const target = run.steps[to]!;
    const flowing = target.status === "running" || target.status === "waiting_approval" || (source.status === "succeeded" && target.status === "ready");
    const done = source.status === "succeeded" && ["running", "succeeded"].includes(target.status);
    const color = done || flowing ? agentFor(run, source.agentId).color : "var(--edge)";
    return {
      id: `${from}->${to}`,
      source: from,
      target: to,
      animated: flowing,
      data: { handoff: handedOff.has(`${from}->${to}`) },
      style: { stroke: color, strokeWidth: flowing ? 2.4 : 1.6, opacity: target.status === "skipped" || target.status === "cancelled" ? 0.35 : 1 },
    };
  });
  return { nodes, edges, direction };
}
