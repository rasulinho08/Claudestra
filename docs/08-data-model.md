# 8. Data model (SQLite)

```sql
-- Configuration
agents(id PK, name, description, model_class, system_prompt, tools JSON, skills JSON,
       integrations JSON, limits JSON, requires_approval JSON, color, icon, enabled, updated_at)

skills(name PK, description, path, hash, updated_at)

integrations(id PK, transport, command, args JSON, url, env_refs JSON, tools JSON,
             status, updated_at)

workflows(id PK, name, description, params JSON, definition JSON, version, updated_at)

settings(key PK, value JSON)            -- model class map, default budget, concurrency, ...

-- Execution
runs(id PK, project_id, prompt, mode, workflow_id NULL, status, plan JSON,
     budget_usd, cost_usd, started_at, ended_at, answer TEXT, error TEXT)

steps(id PK, run_id FK, key,            -- "s1" within the run
      agent_id, task, depends_on JSON, status, attempt,
      model, summary TEXT, cost_usd, input_tokens, output_tokens, cache_read_tokens,
      started_at, ended_at, error TEXT)

events(run_id FK, seq INTEGER, ts, step_id NULL, agent_id NULL, type, data JSON,
       PRIMARY KEY (run_id, seq))

artifacts(id PK, run_id FK, step_id FK, kind, title, path NULL, content NULL, bytes, created_at)

approvals(id PK, run_id FK, step_id FK, kind, request JSON, decision NULL, decided_at NULL, note)
```

## Implemented in Phase 1
`runs`, `steps`, `events`, `artifacts` exist (see `apps/server/src/store.ts`); agents are read from `agents/*.md`
instead of a table, and settings come from `.env`. The remaining tables arrive with their phases.

## Notes
- `events` is the source of truth; `runs`/`steps` are projections kept for fast lists and filters.
- Large content (tool outputs, diffs, files) lives on disk under `workspaces/<runId>/` or in `artifacts.path`; DB rows hold references.
- Migrations via Drizzle; every table has `created_at`/`updated_at` where relevant.
- Retention setting: delete events older than N days but keep run summaries.
