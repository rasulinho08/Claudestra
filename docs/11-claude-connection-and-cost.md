# 11. Connecting to Claude & keeping cost low

## 1. How Claudestra connects to Claude

Claudestra's backend uses the **Claude Agent SDK**. The SDK needs credentials from one of these:

| Mode | How | Billing | Status in Claudestra |
|---|---|---|---|
| **API key** | `ANTHROPIC_API_KEY` from the Anthropic Console | Pay per token, exactly what is used | **Default, recommended** |
| Cloud providers | Amazon Bedrock / Google Vertex credentials | Your cloud bill | Supported by the SDK; optional |
| Claude.ai subscription login (Pro/Max) | Claude Code CLI login on the same machine | Counts against subscription usage limits | **Optional, off by default**, see risks below |

### Can the Claude app / subscription be used instead?
Short answer: **technically possible on your own machine, but not recommended as the main path.**

- Anthropic's terms (clarified in Feb 2026, per press coverage; confirm on Anthropic's Legal & Compliance page)
  restrict Free/Pro/Max subscription OAuth tokens to Claude Code and Claude.ai. Products built on the Agent SDK are
  expected to authenticate with an API key. Third-party apps must not route requests through subscription logins.
  Personal local use of the Claude Code CLI is described as unchanged, but interpretations differ, so treat it as a grey area.
- A multi-agent run makes many more model calls than a chat. On a subscription this **drains the usage window
  (5-hour / weekly limits) much faster** than normal chat, and you can get locked out mid-run.
- With an API key you pay only for tokens used and there are no sudden lockouts. Cost is fully visible per step.

**Decision:** auth is a pluggable setting: `AUTH_MODE=api_key` (default), `claude_cli_login` or `observer`
(both local-only; disabled when deployed), plus `bedrock`/`vertex`. See 1.1. The UI always shows the cost the run *would* cost at API prices,
even in subscription mode, so you can compare.

Sources reviewed: [Anthropic bans third-party subscription authentication (Gigazine)](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block),
[WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/),
[AlternativeTo](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use).
These are secondary reports; **verify against Anthropic's current official documentation before relying on this.**

### 1.1 Step by step: the four ways to connect

MCP is **not** a way to connect Claude to Claudestra. MCP gives Claude *tools* (GitHub, Notion, ...). The connection to
the model is always one of the four ways below.

| # | Mode (`AUTH_MODE`) | Needs | Best for | Deploy? |
|---|---|---|---|---|
| A | `api_key` | API key + prepaid balance | Production, stable, officially supported | Yes |
| B | `claude_cli_login` | Claude Code CLI logged in with your Claude account | Starting locally without an API key | No |
| C | `observer` | Claude Code logged in; hooks send events to Claudestra | Watching your normal Claude Code sessions as a graph | No |
| D | `bedrock` / `vertex` | Cloud credentials | Companies on AWS/GCP | Yes |
| F | `gemini` | `GEMINI_API_KEY` (free tier at aistudio.google.com) | Real AI without a Claude account; Claudestra's own tools (Read/Write/Edit/Glob/Grep/Bash/WebFetch/WebSearch), no skills or MCP (`apps/server/src/gemini.ts`, `local-tools.ts`) | Yes (with login) |
| G | `meta` / `openai_compat` | `META_API_KEY` (api.meta.ai) or `OPENAI_BASE_URL` + `OPENAI_MODEL` | Meta Muse, OpenRouter, DeepSeek, Groq, local Ollama/LM Studio via Chat Completions; Claudestra's own tools, no skills/MCP (`apps/server/src/openai-compat.ts`) | Yes (with login) |
| E | `demo` | Nothing | Trying the UI: simulated agents, no AI calls, $0 (`apps/server/src/demo.ts`) | No |

**A. API key**
1. Create an account at the Anthropic Console, add a small prepaid balance, and create an API key.
2. Copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY=...` and `AUTH_MODE=api_key`.
3. This is billed separately from a Claude.ai subscription. You pay only for tokens used.

**B. Claude login (local, no API key)**
1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`.
2. Run `claude` once in a terminal and sign in with your Claude account (browser opens).
3. In `.env` leave `ANTHROPIC_API_KEY` empty and set `AUTH_MODE=claude_cli_login`.
4. Start Claudestra on the **same machine**. The SDK uses the stored Claude Code login.
5. Caveats: counts against subscription usage limits (multi-agent runs consume them quickly), terms are a grey area
   (section 1 above), and it must be disabled when deployed. Claudestra shows a warning banner in this mode.
   Keep `eco` profile and low budgets here.

**C. Observer mode (visualise your normal Claude Code)**
Claudestra does not run the agents. You work in Claude Code as usual; Claude Code hooks post each event to
Claudestra, which draws the graph.
1. Claudestra exposes `POST http://127.0.0.1:8787/hooks/:event` (local only).
2. A generated snippet is added to the project's `.claude/settings.json`:
   ```json
   {
     "hooks": {
       "SessionStart":     [{ "hooks": [{ "type": "command", "command": "claudestra-hook SessionStart" }] }],
       "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "claudestra-hook UserPromptSubmit" }] }],
       "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "claudestra-hook PreToolUse" }] }],
       "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "claudestra-hook PostToolUse" }] }],
       "SubagentStop":     [{ "hooks": [{ "type": "command", "command": "claudestra-hook SubagentStop" }] }],
       "Stop":             [{ "hooks": [{ "type": "command", "command": "claudestra-hook Stop" }] }],
       "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "claudestra-hook SessionEnd" }] }]
     }
   }
   ```
   `claudestra-hook` stands for `node <path-to-claudestra>/apps/server/bin/claudestra-hook.mjs`, a tiny script that forwards the hook JSON from stdin to the local server and exits 0
   immediately (it must never block or fail Claude Code).
3. The server maps hook payloads to the normal event protocol (doc 6): subagents become nodes, tool calls appear on them.
4. Limits: view-only (no pause/approve from the UI in v1), no CEO routing by Claudestra, flat subagent hierarchy.
   The agents' definitions from `docs/agents/` can still be exported as Claude Code subagents (`.claude/agents/*.md`)
   so the same team is used.

**Max / Ultra / Team subscribers (since 7 Oct 2026):** the plan includes monthly Claude API credits (Max $100, Ultra $200,
Team pooled up to $500) that can be linked to one Console organization without a card and cover Agent SDK use with an
API key from that organization, i.e. `api_key` mode. Setup steps: docs/14 "Claude with an API key".

**Recommended path:** start with **B** (or **C**) locally, switch to **A** before deploying (doc 12).
All modes feed the same event stream, so the UI does not change.

Exact SDK/CLI option names and the current terms must be re-checked at implementation time.

## 2. Does "use only what's needed" work? Yes. Design for it

The goal: cost close to what a single careful chat would cost for simple tasks, and bounded for complex ones.

### 2.1 Router first (skip the company when not needed)
The CEO's first decision is a cheap one: `direct | single_agent | team`.
- `direct`: CEO answers itself, **zero** other agents (simple questions).
- `single_agent`: one specialist, no plan graph.
- `team`: full plan.
The router call uses the cheapest suitable model and a tiny prompt.

### 2.2 Cost profiles

| Profile | Intent | CEO / Architect / Coder / Reviewer | Researcher / BA / Tester / Security / Data | Doc Writer / PM | Plan size cap |
|---|---|---|---|---|---|
| `eco` | cheapest that works | Sonnet-class (Coder: Sonnet) | Haiku-class | Haiku-class | 3 steps |
| `balanced` (default) | good quality, controlled spend | Sonnet-class | Haiku/Sonnet by task | Haiku-class | 6 steps |
| `max` | best quality | Opus-class | Sonnet-class | Haiku-class | 10 steps |

Concrete model IDs live in settings (`modelClasses`), e.g. `claude-haiku-5-5`, `claude-sonnet-5-5`,
`claude-opus-5-5`, so upgrades don't touch code. Profile is selectable per run next to the approval mode.

### 2.3 Hard caps (layered)
1. `dailyBudgetUsd` and `monthlyBudgetUsd` (global, enforced before starting any run).
2. `budgetUsd` per run (default by profile: eco $0.50, balanced $2, max $8).
3. `maxBudgetUsd` and `maxTurns` per step (from the agent definition; SDK enforces).
4. Loop `maxIterations` (default 2) and wall-clock timeout.
5. At 80% of a cap → warning event; at 100% → stop launching steps, CEO finalizes with what exists.

### 2.4 Token hygiene
- **Prompt caching:** keep the stable prefix first (system prompt → skill text → roster → task). Repeated steps and runs
  read the cache at a fraction of input price. Never put timestamps or run IDs before the stable prefix.
- **Summaries, not transcripts:** downstream agents get the upstream `summary` (≤ ~300 tokens); full artifacts only on request.
- **Lazy skills:** only name+description are in context until a skill is used.
- **Tool output truncation:** large tool results are truncated for the model with a pointer to the stored artifact
  (search/read the rest on demand).
- **Targeted reads:** Coder/Reviewer use grep/glob + line ranges, not whole-repo reads.
- **Short outputs by contract:** every agent prompt demands the `StepResult` format; no restating the task.
- **Reuse:** the CEO may reuse a previous run's artifact (same repo, same question) instead of re-researching (v2 memory).
- **Cheap model for the mechanical parts:** summarising, formatting, PM updates, doc generation.

### 2.5 Visibility
- Live cost on every node and the top bar; per-agent and per-model breakdown after the run.
- "Cost preview" before executing a team plan (estimated class low/medium/high + cap), skipped in `auto` unless over the cap.
- Weekly report: spend per agent, most expensive steps, cache hit rate. Used to tune profiles.

## 3. Typical expectation (not a guarantee)
Simple question → ~1 router call + 1 answer. Medium task (research + code + review) → 3–4 steps with caps.
Large task → bounded by `budgetUsd`; the system stops and reports instead of silently growing.
Actual prices change; read current pricing in the Anthropic Console and set the budgets accordingly.
