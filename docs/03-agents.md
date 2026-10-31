# 3. Agents

## Roster (13 agents + CEO)

Full per-agent specs (prompt drafts, tools, limits, gates, failure modes) are in [agents/](agents/README.md).

| Agent | Role | Default tools | Model class | Typical position |
|---|---|---|---|---|
| **CEO** | Decision maker: plans, picks agents, reviews, re-plans, writes final answer | none (reads roster + artifacts) | strong | first / checkpoints / last |
| **Researcher** | Finds facts, repos, docs, prior art; cites sources | web search/fetch, GitHub search | mid | early |
| **Business Analyst** | Turns goals into requirements, user stories, acceptance criteria | read artifacts | mid | after research |
| **Architect** | System design, data model, tech choices | read repo, read artifacts | strong | before coding |
| **Coder** | Implements in the sandbox | read/write/edit files, shell (sandboxed), git | strong | middle |
| **Reviewer** | Reviews diffs for bugs, style, requirements fit | read files, git diff | strong | after coder |
| **Tester / QA** | Writes and runs tests, reports failures | files, shell (sandboxed) | mid | after coder |
| **Security Checker** | Looks for vulnerabilities, secrets, risky deps | read files, scanners | mid | before finish |
| **Doc Writer** | README, API docs, changelog, user guides | read/write docs | cheap | late |
| **Data Analyst** | Queries data, summarises numbers, builds charts | DB/Drive/Sheets MCP | mid | on demand |
| **Project Manager** | Tracks tasks, writes status, files issues/tickets | GitHub issues, Notion | cheap | on demand / end |
| **Designer** | Look and feel: layout, colours, CSS, SVG, accessibility; never changes behaviour | read/write/edit files | mid | after coder (polish) |
| **Translator** | Translations and localisation (az, en, ru, tr…) keeping code and placeholders | read/write/edit files | mid | late |
| **Marketer** | Landing copy, product texts, social posts, simple go-to-market; cites research, invents nothing | files, web search/fetch | mid | on demand |

"Model class" is mapped in config to concrete model IDs, so upgrades are one-line changes.

## Agent definition format

One file per agent in `agents/`, e.g. `agents/coder.md`:

```markdown
---
id: coder
name: Coder
description: Implements features and fixes in the sandbox repo. Use after requirements/design exist.
modelClass: strong
tools: [Read, Write, Edit, Glob, Grep, Bash]
skills: [typescript-style, git-workflow]
integrations: [github:read]
limits:
  maxTurns: 40
  maxBudgetUsd: 1.50
requiresApproval: [Bash:rm, Bash:git push]
color: "#3b82f6"
icon: code
---
You are the Coder at a small software company.
... system prompt body ...
```

The `description` matters most: the CEO uses it (plus `modelClass` as a cost hint) to decide whether the agent is needed.

## CEO behaviour

The CEO never does the work. It has four modes, each a separate short SDK session with structured output:

### 1. `plan`
Input: user prompt, roster, previous run summaries (optional), budget.
Output (validated with Zod):

```ts
type Plan = {
  summary: string;
  steps: Array<{
    id: string;                 // "s1"
    agent: string;              // agent id
    task: string;               // specific instruction
    dependsOn: string[];        // step ids; empty = can start now
    inputs?: string[];          // artifact ids to attach
    successCriteria: string;
    onFail?: "retry" | "ask_ceo" | "abort";
  }>;
  loops?: Array<{ between: [string, string]; until: string; maxIterations: number }>; // e.g. coder↔reviewer
  estimatedCostClass: "low" | "medium" | "high";
};
```

### 2. `review`
Called at checkpoints (after a phase, or when a step fails/is rejected). Returns `continue | add_steps | replan | finish | ask_user`.

### 3. `decide` (small questions)
Used when an agent asks "which option?" — CEO answers, or escalates to the user.

### 4. `finalize`
Writes the user-facing answer from artifacts.

### Token-saving rules baked into the CEO prompt
- Prefer the **smallest** set of agents that satisfies the request.
- A pure question → at most Researcher (or none) → finalize.
- Never schedule Reviewer/Tester without a Coder output to review.
- Prefer cheap model classes for read-only summarisation.
- Respect the run budget; if the plan's estimate exceeds it, propose a reduced plan.

## Handoffs
Agents do not talk to each other directly. Each step returns:

```ts
type StepResult = {
  summary: string;              // short, always passed downstream
  artifacts: ArtifactRef[];     // full outputs stored on disk/DB (reports, diffs, files)
  status: "ok" | "needs_input" | "failed";
  questions?: string[];         // for CEO/user
};
```

Downstream steps receive the upstream **summary** by default and fetch full artifacts only when needed
(keeps context small). The UI draws an edge for every handoff and shows the payload on click.

## Agent-to-agent loops
Coder ⇄ Reviewer is the main loop: Reviewer returns findings → CEO (or the plan's `loops` rule) re-queues Coder with
the findings → Reviewer re-checks, up to `maxIterations`.
