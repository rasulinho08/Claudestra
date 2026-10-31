# 5. Skills, tools & integrations

Three different things, kept separate:

| | What it is | Where it lives | Attached to |
|---|---|---|---|
| **Tool** | A single capability the model can call (Read, Bash, WebSearch) | Built into the SDK | Agent `tools` allow-list |
| **Skill** | Instructions + optional scripts/files that teach *how* to do something | `skills/<name>/SKILL.md` | Agent `skills` list |
| **Integration** | An external app exposed as tools via MCP (GitHub, Notion, Drive, Figma, Postgres, ...) | MCP server config | Agent `integrations` list, with per-tool allow-list |

## Skills

Format (same convention as Claude Code skills):

```
skills/typescript-style/
  SKILL.md        # frontmatter: name, description; body: instructions
  examples/...    # optional supporting files
  scripts/...     # optional scripts the agent may run
```

How loading works:
1. Skill Library scans `skills/` and indexes name + description.
2. When a step starts, the Runner materialises only that agent's skills into the step's
   workspace (`.claude/skills/<name>/`) and enables the SDK's skill support for that session
   (`settingSources: ["project"]` + `Skill` tool allowed).
3. The model sees skill names/descriptions and loads the full body on demand — so unused skills cost almost no tokens.

4. Other engines (Gemini, Meta, OpenAI-compatible, demo; upgrade A2 "Skills 2.0"): the agent's system prompt gets a
   one-line catalogue (`name: description`) and a `Skill` tool (`apps/server/src/local-tools.ts`) that returns the
   skill body plus the paths of its extra files, which the agent reads with `Read`. Same lazy loading, same cost profile.

UI: **Skills screen** lists and filters skills, shows which agents use them, attaches/detaches a skill per agent with
a checkbox (`PUT /api/skills/:name/agents`, rewrites only the `skills:` line of each agent file), imports a skill
folder from a GitHub link (`POST /api/skills/import`; folder, `blob/.../SKILL.md`, repo root or raw file; ≤40 files,
≤2 MB; a collection folder answers with the skill folders to pick from), and edits or deletes skills.

**Skill pack.** `skills/` ships 34 skills with zero installs (standard library, plain HTML/CSS/JS only), pre-attached
to the agents that need them: web-app-basics, responsive-css, svg-graphics, accessibility-check, seo-basics,
landing-page-copy, social-media-posts, unit-testing-node, python-testing, test-plan, debugging-method,
refactoring-safely, git-hygiene, security-web-owasp, secrets-hygiene, dependency-audit, data-cleaning-csv,
charts-without-libraries, sql-basics, market-research, fact-checking, competitor-analysis, azerbaijani-writing,
localization-i18n, readme-writing, api-docs, changelog, project-plan, architecture-decision-records,
system-design-checklist, plus clean-code, code-review-checklist, source-citation, user-stories.

## Integrations (MCP)

An integration record:

```ts
type Integration = {
  id: string;                       // "github"
  transport: "stdio" | "http" | "sse";
  command?: string; args?: string[]; url?: string;
  env?: Record<string, SecretRef>;  // secrets referenced, never inlined
  tools: Array<{ name: string; access: "read" | "write" }>;  // discovered
  status: "connected" | "error" | "unconfigured";
};
```

Per agent, you choose integrations and **which tools** are allowed, e.g. Researcher gets `github:search_code,
github:get_file_contents` (read) but not `github:create_pull_request`.
The Runner builds `mcpServers` for that step and sets `allowedTools` to `mcp__<server>__<tool>` entries.

Starter catalog: GitHub, web search/fetch, filesystem (sandbox), Notion, Google Drive, Google Calendar, Figma,
Postgres/SQLite. Add any MCP server by URL or command.

## Custom tools (in-process)
Small TS functions exposed as in-process MCP tools (e.g. `emit_artifact`, `ask_user`, `report_progress`).
Two are mandatory for every agent:
- `emit_artifact(kind, title, content|path)` → creates an Artifact and an UI event.
- `ask_user(question, options?)` → pauses the step as `needs_input`.

## Permission model
Order of evaluation for any tool call:
1. Agent allow-list (tools + MCP tools). Not listed → denied.
2. `requiresApproval` patterns → depends on the run's approval mode (doc 4): `manual`/`smart` → step enters
   `waiting_approval` and the UI asks; `auto` → approved automatically and logged, unless the action matches `neverAuto`.
3. Sandbox rules (path must be inside the workspace; network egress allow-list for Bash).
4. Otherwise allowed.

Implemented via the SDK's permission callback / `PreToolUse` hook so the decision is also emitted as an event.

## Secrets
Stored in the OS keychain or an encrypted file; referenced by `SecretRef`. Never written to events, logs, prompts,
or artifacts (redaction pass on every event before persisting).
