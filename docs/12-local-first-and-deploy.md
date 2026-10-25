# 12. Local first, deploy later

## Phase A: local (v1)
- `npm run dev` starts server (`:8787`) and web (`:5173`). SQLite file in `data/`.
- Binds to `127.0.0.1` only. No login needed (single owner).
- Secrets in `.env` (git-ignored) or OS keychain. `ANTHROPIC_API_KEY` required in default auth mode.
- Sandbox: git worktree per run under `workspaces/`. Agents cannot touch paths outside it (permission hook).
- `auto` approval is safe-ish locally because of sandbox + budgets, but still never bypasses them.

## Phase B: deploy
Required before exposing to a network:

| Concern | Change |
|---|---|
| Auth | Add login (single-user token or OAuth); all API + SSE behind it |
| Auth mode | Force `AUTH_MODE=api_key`; disable `claude_cli_login` |
| Sandbox | Docker container per run (no host mount, resource limits, egress allow-list) |
| Secrets | Secret manager / encrypted store instead of `.env` |
| DB | SQLite on a persistent volume, or Postgres if multi-instance |
| Transport | HTTPS; SSE behind a proxy with buffering disabled |
| Limits | Rate limiting, per-user budgets, concurrency caps |
| Auto-approve | Off by default on deploy; requires explicit setting and `neverAuto` list |
| Observability | Structured logs, error tracking, backup of `events` |

Suggested targets: a single VM/container (Fly.io, Railway, VPS) for server + SQLite; static web on the same host or a CDN.
Vercel-style serverless is a poor fit for the long-running SSE/agent processes.
