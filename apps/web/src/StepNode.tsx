import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StepNode as StepNodeType } from "./graph.ts";
import { iconFor } from "./icons.ts";
import { usd } from "./format.ts";
import { t, type Key } from "./i18n.ts";

function StepNodeView({ data }: NodeProps<StepNodeType>) {
  const { step, agent, selected, direction } = data;
  const [inPos, outPos] = direction === "TB" ? [Position.Top, Position.Bottom] : [Position.Left, Position.Right];
  const label = step.id === "final" ? `${agent.name} · ${t("step.final")}` : agent.name;
  return (
    <div
      className={`node node-${step.status} ${selected ? "node-selected" : ""}`}
      style={{ "--agent": agent.color } as React.CSSProperties}
      title={step.note ?? step.task}
    >
      <Handle type="target" position={inPos} isConnectable={false} />
      <div className="node-head">
        <span className="node-icon">{iconFor(agent.icon)}</span>
        <span className="node-name">{label}</span>
        <span className={`node-status st-${step.status}`}>{t(`step.${step.status}` as Key)}</span>
      </div>
      <div className="node-task">{step.note && step.status === "skipped" ? step.note : step.task || "…"}</div>
      <div className="node-foot">
        <span className="node-tool">{step.status === "running" && step.lastTool ? `⚙ ${step.lastTool}` : step.model ?? ""}</span>
        <span>{usd(step.costUsd)}</span>
      </div>
      <Handle type="source" position={outPos} isConnectable={false} />
    </div>
  );
}

export const StepNode = memo(StepNodeView);
