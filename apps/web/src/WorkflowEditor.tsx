import { useCallback, useMemo, useState, type DragEvent } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Graph, layout } from "@dagrejs/dagre";
import { iconFor } from "./icons.ts";

export type EditorStep = { id: string; agent: string; task: string; dependsOn: string[]; successCriteria: string; loopBackTo: string };
type AgentLite = { id: string; name: string; color: string; icon: string; description: string };
type StepData = { step: EditorStep; agent: AgentLite | undefined };
type StepNode = Node<StepData, "edit">;

function EditNode({ data, selected }: NodeProps<StepNode>) {
  const color = data.agent?.color ?? "#8a92a6";
  return (
    <div className={`node edit-node ${selected ? "node-selected" : ""}`} style={{ "--agent": color } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} />
      <div className="node-head">
        <span className="node-icon">{iconFor(data.agent?.icon ?? "bot")}</span>
        <span className="node-name">{data.agent?.name ?? data.step.agent}</span>
        <span className="node-status">{data.step.id}</span>
      </div>
      <div className="node-task">{data.step.task || "Click to write the task…"}</div>
      <div className="node-foot">
        <span>{data.step.loopBackTo ? `↺ ${data.step.loopBackTo}` : ""}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { edit: EditNode };

function autoPositions(steps: EditorStep[]): Record<string, { x: number; y: number }> {
  const g = new Graph();
  g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const s of steps) g.setNode(s.id, { width: 230, height: 104 });
  for (const s of steps) for (const d of s.dependsOn) if (steps.some((x) => x.id === d)) g.setEdge(d, s.id);
  layout(g);
  return Object.fromEntries(steps.map((s) => {
    const n = g.node(s.id) as { x: number; y: number };
    return [s.id, { x: n.x - 115, y: n.y - 52 }];
  }));
}

function reaches(edges: Edge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const walk = (x: string): boolean => {
    if (x === to) return true;
    if (seen.has(x)) return false;
    seen.add(x);
    return edges.filter((e) => e.source === x).some((e) => walk(e.target));
  };
  return walk(from);
}

type Props = {
  steps: EditorStep[];
  positions: Record<string, { x: number; y: number }>;
  agents: AgentLite[];
  onSave: (steps: EditorStep[], positions: Record<string, { x: number; y: number }>) => void;
  onCancel: () => void;
};

function EditorInner({ steps, positions, agents, onSave, onCancel }: Props) {
  const byAgent = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const initialPos = useMemo(() => ({ ...autoPositions(steps), ...positions }), [steps, positions]);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(
    steps.map((s) => ({ id: s.id, type: "edit", position: initialPos[s.id] ?? { x: 0, y: 0 }, data: { step: s, agent: byAgent.get(s.agent) } })),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(steps.flatMap((s) => s.dependsOn.map((d) => ({ id: `${d}->${s.id}`, source: d, target: s.id }))));
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const patchStep = (id: string, patch: Partial<EditorStep>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { step: { ...n.data.step, ...patch }, agent: byAgent.get(patch.agent ?? n.data.step.agent) } } : n)));

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      // An edge means "target depends on source"; refuse cycles.
      if (reaches(edges, c.target, c.source)) return setError("That connection would create a loop. Use “sends back to” for fix loops.");
      setError(null);
      setEdges((es) => addEdge({ ...c, id: `${c.source}->${c.target}` }, es));
    },
    [edges, setEdges],
  );

  const addStep = (agentId: string, position?: { x: number; y: number }) => {
    let n = nodes.length + 1;
    while (nodes.some((x) => x.id === `s${n}`)) n++;
    const id = `s${n}`;
    const step: EditorStep = { id, agent: agentId, task: "", dependsOn: [], successCriteria: "", loopBackTo: "" };
    const pos = position ?? { x: 80 + (nodes.length % 4) * 260, y: 60 + Math.floor(nodes.length / 4) * 150 };
    setNodes((ns) => [...ns, { id, type: "edit", position: pos, data: { step, agent: byAgent.get(agentId) } }]);
    setSelected(id);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const agentId = e.dataTransfer.getData("application/claudestra-agent");
    if (agentId) addStep(agentId, screenToFlowPosition({ x: e.clientX - 115, y: e.clientY - 40 }));
  };

  const removeSelected = () => {
    if (!selected) return;
    setNodes((ns) => ns.filter((n) => n.id !== selected).map((n) => (n.data.step.loopBackTo === selected ? { ...n, data: { ...n.data, step: { ...n.data.step, loopBackTo: "" } } } : n)));
    setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
    setSelected(null);
  };

  function save() {
    const stepsOut = nodes.map((n) => ({ ...n.data.step, dependsOn: edges.filter((e) => e.target === n.id).map((e) => e.source) }));
    const empty = stepsOut.find((s) => !s.task.trim());
    if (stepsOut.length === 0) return setError("Add at least one step.");
    if (empty) return setError(`Step ${empty.id} has no task.`);
    onSave(stepsOut, Object.fromEntries(nodes.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])));
  }

  const current = nodes.find((n) => n.id === selected)?.data.step;
  const ancestors = current ? nodes.map((n) => n.id).filter((id) => id !== current.id && reaches(edges, id, current.id)) : [];

  return (
    <div className="wf-editor">
      <div className="wf-palette">
        <div className="small muted">Drag an agent onto the canvas (or click it)</div>
        {agents.filter((a) => a.id !== "ceo").map((a) => (
          <button
            key={a.id}
            className="palette-item"
            style={{ borderLeftColor: a.color }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/claudestra-agent", a.id)}
            onClick={() => addStep(a.id)}
            title={a.description}
          >
            <span style={{ color: a.color }}>{iconFor(a.icon)}</span> {a.name}
          </button>
        ))}
        <p className="small muted">Connect a node's right dot to another node's left dot: the second step then gets the first one's result. Select an edge and press Backspace to remove it.</p>
      </div>
      <div className="wf-canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow<StepNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelected(n.id)}
          onPaneClick={() => setSelected(null)}
          deleteKeyCode={["Backspace", "Delete"]}
          onNodesDelete={(ds) => ds.forEach((d) => d.id === selected && setSelected(null))}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--grid)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="wf-form">
        <div className="row-gap">
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save new version
          </button>
        </div>
        {error && <div className="error small">{error}</div>}
        {current ? (
          <>
            <h3>Step {current.id}</h3>
            <label className="field">
              <span className="small muted">Agent</span>
              <select value={current.agent} onChange={(e) => patchStep(current.id, { agent: e.target.value })}>
                {agents.filter((a) => a.id !== "ceo").map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="small muted">Task (use {"{{prompt}}"} or other {"{{params}}"})</span>
              <textarea rows={6} value={current.task} onChange={(e) => patchStep(current.id, { task: e.target.value })} />
            </label>
            <label className="field">
              <span className="small muted">Success criteria</span>
              <textarea rows={2} value={current.successCriteria} onChange={(e) => patchStep(current.id, { successCriteria: e.target.value })} />
            </label>
            <label className="field">
              <span className="small muted">If it requests changes, send back to</span>
              <select value={current.loopBackTo} onChange={(e) => patchStep(current.id, { loopBackTo: e.target.value })}>
                <option value="">— nobody —</option>
                {ancestors.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <button className="ghost" onClick={removeSelected}>
              Delete step
            </button>
          </>
        ) : (
          <p className="muted small">Select a step to edit it.</p>
        )}
      </div>
    </div>
  );
}

export function WorkflowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}
