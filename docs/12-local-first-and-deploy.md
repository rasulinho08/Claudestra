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
| Auth | ✅ Implemented: `AUTH_TOKEN` and/or users with roles (`npm run user -- add NAME owner`); HttpOnly cookie; SSE and hooks protected; the server refuses to bind to a non-local `HOST` without login |
| Auth mode | Force `AUTH_MODE=api_key`; disable `claude_cli_login` |
| Sandbox | Docker container per run (no host mount, resource limits, egress allow-list) |
| Secrets | Secret manager / encrypted store instead of `.env` |
| DB | SQLite on a persistent volume, or Postgres if multi-instance |
| Transport | HTTPS; SSE behind a proxy with buffering disabled |
| Limits | Rate limiting, per-user budgets, concurrency caps |
| Auto-approve | Off by default on deploy; requires explicit setting and `neverAuto` list |
| Results | Expose `PREVIEW_PORT` (or put it behind its own host and set `PREVIEW_URL`); set `WEB_ORIGINS` if the UI is served from another origin; `GITHUB_TOKEN` is the owner's, so only owners may push |
| Observability | Structured logs, error tracking, backup of `events` |

Suggested targets: a single VM/container (Fly.io, Railway, VPS) for server + SQLite; static web on the same host or a CDN.
Vercel-style serverless is a poor fit for the long-running SSE/agent processes.
