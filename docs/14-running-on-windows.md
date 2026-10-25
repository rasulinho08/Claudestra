# 14. Running Claudestra on Windows (cmd)

## One-time setup

1. **Node.js 22.13 or newer** (LTS "22" or "24" from nodejs.org). Check in cmd:
   ```cmd
   node -v
   ```
2. **Git for Windows** (git-scm.com). Claude Code uses its Git Bash for the agents' shell commands.
3. **Claude Code**, logged in with your Claude account (only needed for `AUTH_MODE=claude_cli_login`):
   ```cmd
   npm install -g @anthropic-ai/claude-code
   claude
   ```
   Sign in in the browser window that opens, then type `/exit` to leave Claude Code.

## Get the project

```cmd
cd %USERPROFILE%\Documents
git clone https://github.com/rasulinho08/Claudestra.git
cd Claudestra
npm install
copy .env.example .env
```

Open `.env` in Notepad (`notepad .env`) and check at least:

| Setting | Value |
|---|---|
| `AUTH_MODE` | `claude_cli_login` (your Claude login) or `api_key` (then fill `ANTHROPIC_API_KEY`) |
| `DEFAULT_APPROVAL_MODE` | `smart` to start; `manual` for untrusted tasks (Windows has no OS sandbox) |
| `DAILY_BUDGET_USD` | e.g. `3`, so a mistake can never cost more than that per day |

## Every day

```cmd
cd %USERPROFILE%\Documents\Claudestra
npm run dev
```

Open **http://127.0.0.1:5173** in the browser. Stop with `Ctrl+C` in the cmd window.

Optional:
- Robot on the second monitor: click **▶ Stage window** and drag that window to monitor 2 (F11 for full screen).
- OBS: Browser source `http://127.0.0.1:5173/#/stage?run=live&transparent=1&hud=0` (doc 13).

## Single window / no dev server

```cmd
npm run build
npm start
```
Then open **http://127.0.0.1:8787** (app and API on one port).

## Updating

```cmd
git pull
npm install
npm run dev
```

## Useful commands

| Command | What it does |
|---|---|
| `npm test` | Runs all tests (no Claude calls, free) |
| `npm run typecheck` | TypeScript check |
| `npm run user -- add NAME owner` | Turns on login and prints a token for NAME (roles: owner, operator, viewer) |
| `npm run user -- list` | Lists users |

## Troubleshooting

| Problem | Fix |
|---|---|
| `node:sqlite` / `ERR_UNKNOWN_BUILTIN_MODULE` | Node is older than 22.13: install a newer Node |
| "Server is not reachable on :8787" in the page | The server window shows the error; usually `.env` has a typo in `AUTH_MODE` |
| Runs fail with an authentication error | Run `claude` once in cmd and log in again, or switch to `AUTH_MODE=api_key` |
| Port already in use | Close the other `npm run dev`, or set `PORT=8788` in `.env` (then the web app needs `set CLAUDESTRA_URL=http://127.0.0.1:8788` before `npm run dev`) |
| Agents cannot run shell commands | Install Git for Windows, then restart cmd |
| The ExperimentalWarning about SQLite | Harmless; Node marks `node:sqlite` as experimental |
