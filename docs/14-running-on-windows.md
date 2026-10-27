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

## Try it without any AI (demo mode)

No login and no API key needed, nothing is charged. Start with:
```cmd
npm run demo
```
(instead of `npm run dev`; it ignores `AUTH_MODE` in `.env`), then send a task such as `make me a basic calculator`. The CEO plans with simple
keyword rules, agents "work" with placeholder text, call tools through the real approval policy (you will get an
approval for `npm install`), the reviewer sends the coder back once, real files appear in the Files tab, and the
robot on the Stage does the whole journey. Switch `AUTH_MODE` back to `claude_cli_login` or `api_key` for real work.

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

## If something does not work: `npm run doctor`

```cmd
npm run doctor
```
It checks Node, `node:sqlite`, dependencies, `.env`, `AUTH_MODE`, the Claude Code CLI, Git, the port, and then tries to
start the server for 25 seconds and prints its output. Every FAIL line says what to do.

The server always prints `[claudestra] starting server…` and then one line per step. If the web app shows
`ECONNREFUSED 127.0.0.1:8787`, look at the `[server]` lines in the same window: the last one says where it stopped.

## Claude login without email access

`claude` opens a browser page on claude.ai. If that browser is **already logged in to claude.ai**, the page only asks
you to **Authorize**: no email code is needed. Click it and return to cmd.

- Browser did not open: cmd shows a long URL; copy it into the browser where you are logged in to claude.ai.
- The page asks for a code from your email: you are not logged in in that browser. Use the browser/profile where
  claude.ai is open, or "Continue with Google" if your account uses Google.
- No way to log in right now: use `AUTH_MODE=api_key` with a key from console.anthropic.com (that also needs a login),
  or wait until you have email access.
- Check: run `claude`; if it opens a chat prompt without asking to log in, you are logged in (type `/exit`).

## Useful commands

| Command | What it does |
|---|---|
| `npm run doctor` | Checks the setup and tries a server start |
| `npm run server` | Server only, no auto-reload (clearer output) |
| `npm test` | Runs all tests (no Claude calls, free) |
| `npm run typecheck` | TypeScript check |
| `npm run user -- add NAME owner` | Turns on login and prints a token for NAME (roles: owner, operator, viewer) |
| `npm run user -- list` | Lists users |

## Troubleshooting

| Problem | Fix |
|---|---|
| `node:sqlite` / `ERR_UNKNOWN_BUILTIN_MODULE` | Node is older than 22.13: install a newer Node |
| `ECONNREFUSED 127.0.0.1:8787` / "Server is not reachable" | The server did not start: read the `[server]` lines or run `npm run doctor` |
| Server stops after `loaded …\.env` with `tsx watch` | Known Windows issue with tsx's watch mode: `npm run dev` therefore runs the server without auto-reload. `npm run dev:watch` (auto-reload for development) may hang on Windows |
| Nothing after `[server] > tsx …` for a long time | First start after `npm install` can be slow while antivirus scans `node_modules`; wait, or run `npm run doctor` |
| "OAuth session expired and could not be refreshed" | The Claude Code login expired: in cmd run `claude`, type `/login`, authorize in the browser, `/exit`. Then send the task again (no restart needed) |
| Runs fail with an authentication error | Run `claude` once in cmd and log in again, or switch to `AUTH_MODE=api_key` |
| Port already in use | Close the other `npm run dev`, or set `PORT=8788` in `.env` (then the web app needs `set CLAUDESTRA_URL=http://127.0.0.1:8788` before `npm run dev`) |
| Agents cannot run shell commands | Install Git for Windows, then restart cmd |
| The ExperimentalWarning about SQLite | Harmless; Node marks `node:sqlite` as experimental |
