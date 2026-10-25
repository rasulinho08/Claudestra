# 2. Architecture

## Overview

```
┌──────────────┐  prompt   ┌────────────────────────────────────────────┐
│  Web UI      │──────────▶│  Backend (Node + TypeScript)               │
│  React +     │           │                                            │
│  React Flow  │◀──events──│  API ─▶ Orchestrator ─▶ Agent Runner(s)    │
└──────────────┘  SSE/WS   │            │                │              │
                           │            ▼                ▼              │
                           │      Event Bus ◀── Claude Agent SDK        │
                           │        │  │             │      │           │
                           │        │  ▼             ▼      ▼           │
                           │        │ SQLite     Skills   MCP servers   │
                           │        ▼            (files)   (GitHub,web…)│
                           │   stream to UI                             │
                           └────────────────────────────────────────────┘
```

## Components

| Component | Responsibility |
|---|---|
| **API** | REST for CRUD (agents, skills, workflows, runs); SSE/WebSocket endpoint for live run events |
| **Orchestrator** | Owns a Run. Asks the CEO for a plan, schedules steps (sequential/parallel), handles loops, approvals, cancel, budget |
| **Agent Runner** | Wraps one SDK `query()` call for one step: builds options (prompt, tools, skills, MCP, budget), translates SDK messages into Claudestra events |
| **Event Bus** | In-process pub/sub; every event is persisted then fanned out to connected UIs |
| **Store** | SQLite: agents, skills, integrations, workflows, runs, steps, events, artifacts |
| **Skill Library** | Folders of `SKILL.md` (+ files) on disk; attached to agents by name |
| **Integration Registry** | Configured MCP servers + credentials; attached to agents with per-tool allow-lists |
| **Sandbox** | Per-run working directory (git worktree or container) where file-writing agents operate |
| **Web UI** | Run canvas, inspector, library screens, replay |

## Key decision: who orchestrates?

Two options exist:

**A. SDK subagents** — one `query()` for the CEO with `agents: {...}`; the CEO calls subagents through the SDK's
subagent tool.
- (+) Simple, Claude does the routing natively.
- (−) Subagents cannot spawn subagents (flat hierarchy). Less control over parallelism, retries and per-step budgets.
  Event attribution relies on `parent_tool_use_id`.

**B. Our own orchestrator** — the CEO is one `query()` that returns a **plan** (structured JSON). Our code then
runs each step as its **own** `query()` session.
- (+) Full control: parallel steps, loops (coder ↔ reviewer), per-step budget/model/tools, clean per-node events,
  resume/replay, saved workflows are just stored plans.
- (−) We write the scheduler.

**Decision: B** for the core, because a visual graph with saved workflows needs steps as first-class objects.
Option A remains available *inside* a step (an agent may use SDK subagents for its own sub-tasks).

## Run lifecycle (dynamic mode)

1. UI `POST /runs {prompt, mode: "dynamic" | workflowId}`.
2. Orchestrator creates Run, emits `run.started`.
3. **CEO.plan**: CEO session receives the prompt + agent roster (names, one-line descriptions, cost class).
   Returns a `Plan`: ordered/parallel steps, each naming an agent, its task, inputs from earlier steps, and
   success criteria. Emits `plan.created` → UI draws the graph (pending nodes).
4. (Optional) approval gate on the plan.
5. For each ready step: Agent Runner executes, streaming `step.*` and `tool.*` events; node lights up.
6. Step output is stored as an **artifact** and passed to dependents.
7. **CEO.review** at checkpoints (after each phase or on failure): continue / insert steps / re-plan / finish.
8. CEO.finalize: composes the answer. `run.completed` with total cost.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 22.13+ / TypeScript | Agent SDK is first-class in TS |
| HTTP | Hono or Fastify | Light, SSE support |
| Live transport | SSE (default), WebSocket later | One-way stream fits; simple reconnect via `Last-Event-ID` |
| DB | SQLite via built-in `node:sqlite` (plain SQL) | Zero ops, no native build step, replay-friendly |
| Frontend | React + Vite + `@xyflow/react` (React Flow) + dagre layout | Node graph out of the box |
| State | Zustand | Event-reducer store |
| Styling | Plain CSS with theme tokens | Small; Tailwind can come later |
| Validation | Zod | Plans, events, configs |

## Repo layout (repo root)

```
  apps/
    server/        # API, orchestrator, runner
    web/           # React UI
  packages/
    protocol/      # Zod schemas + TS types for events/plan (shared)
  skills/          # skill library (SKILL.md folders)
  agents/          # agent definitions (YAML/MD)
  workspaces/      # per-run sandboxes (gitignored)
  docs/          # this documentation
  data/claudestra.db
```
