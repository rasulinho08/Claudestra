import { useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { RunView } from "./run-state.ts";
import { buildGraph, NODE_HEIGHT, NODE_WIDTH, type StepNode as StepNodeType } from "./graph.ts";
import { StepNode } from "./StepNode.tsx";

const nodeTypes = { step: StepNode };

type Props = {
  run: RunView;
  selected: string | null;
  onSelectStep: (id: string) => void;
  onSelectEdge: (edge: { from: string; to: string }) => void;
};

function CanvasInner({ run, selected, onSelectStep, onSelectEdge }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize((s) => (Math.abs(s.width - width) > 40 || Math.abs(s.height - height) > 40 ? { width, height } : s));
    });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const { nodes, edges, direction } = useMemo(() => buildGraph(run, selected, size), [run, selected, size]);
  const { fitBounds } = useReactFlow();
  const shape = `${direction}:${size.width}x${size.height}:${nodes.map((n) => n.id).join(",")}`;

  // Re-fit when nodes are added, the layout direction flips or the canvas resizes, not on every status change.
  // Bounds come from our own layout, so the fit never uses stale positions from the previous render.
  useEffect(() => {
    if (nodes.length === 0) return;
    const xs = nodes.map((n) => n.position.x);
    const ys = nodes.map((n) => n.position.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const bounds = { x, y, width: Math.max(...xs) + NODE_WIDTH - x, height: Math.max(...ys) + NODE_HEIGHT - y };
    // A single small node would otherwise be blown up to fill the canvas.
    const pad = Math.max(0, (size.width - NODE_WIDTH * 2.2) / 2);
    const t = setTimeout(() => fitBounds(nodes.length === 1 ? { ...bounds, x: x - pad, width: bounds.width + pad * 2 } : bounds, { padding: 0.12, duration: 300 }), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, fitBounds]);

  return (
    <div ref={box} className="flow-box">
      <ReactFlow<StepNodeType, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectStep(node.id)}
        onEdgeClick={(_, edge) => onSelectEdge({ from: edge.source, to: edge.target })}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.6}
      >
        <Background gap={20} size={1} color="var(--grid)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => (n.data as { agent: { color: string } }).agent.color} maskColor="var(--minimap-mask)" />
      </ReactFlow>
    </div>
  );
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
