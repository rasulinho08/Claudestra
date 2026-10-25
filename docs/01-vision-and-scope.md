# 1. Vision & scope

## Problem
Using Claude through a chat or terminal UI hides the work: you send a prompt, wait, and get an answer.
You cannot see *who* did *what*, *in which order*, *with which tools*, or *at what cost*.

## Vision
A company made of agents instead of employees:

- **You** are the client. You type a prompt.
- **CEO agent** (decision maker) reads it, makes a plan, and picks only the agents that are needed.
- **Specialists** (researcher, business analyst, architect, coder, reviewer, tester, ...) do the work, hand results
  to each other, and pull data from connected apps (GitHub, web, Drive, Notion, ...).
- **The UI** shows all of it live as a graph: work flowing from node to node, each node inspectable.

It resembles n8n visually (nodes and edges, saved flows, integrations), but the logic differs:

| | n8n | Claudestra |
|---|---|---|
| Node = | fixed integration action | an LLM agent with a role, skills and tools |
| Routing | you draw it, it runs as drawn | CEO decides at runtime (or you pin a saved workflow) |
| Data between nodes | JSON items | natural-language + structured artifacts |
| Failure | error branch | CEO re-plans, reviewer sends work back |

## Goals (v1)
1. Send a prompt, watch the CEO plan and agents execute on a live graph.
2. Click any node to see its messages, tool calls, files touched, tokens, cost.
3. CEO activates only the agents a task needs (token control).
4. Attach **skills** and **tools/apps (MCP)** per agent from a library.
5. Save a good run as a reusable **workflow** (pinned graph) and re-run it.
6. Replay any past run.
7. Human approval gates for risky actions.

## Non-goals (v1)
- Multi-user / teams / auth. Single local user first.
- Hosting for third parties, billing, marketplace.
- Drag-and-drop *authoring* of arbitrary graphs (v1 edits workflows via a form/JSON; canvas is mainly for observing).
- Training or fine-tuning.
- Cron/webhook triggers (v2).

## Users
One power user (the owner). Design for local use; keep the door open for multi-user.

## Success criteria
- A non-trivial prompt ("research X, write a spec, implement it, review it") runs end-to-end with the graph
  updating in real time (<500 ms from SDK event to UI).
- A simple prompt ("what is X?") activates CEO + 1 agent at most.
- Any past run can be replayed step by step from stored events.

## Important constraint: authentication & billing
The default and officially supported way to run the SDK is an **Anthropic API key** (pay per token, only what is
used). Using a Claude.ai subscription login inside a custom app is restricted by Anthropic's terms and is
therefore optional and off by default. Full analysis, options and the cost-optimisation design are in
[doc 11](11-claude-connection-and-cost.md).

## Delivery approach
Local first (runs on the owner's machine), deploy later. See [doc 12](12-local-first-and-deploy.md).
