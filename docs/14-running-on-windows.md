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

## Claude with an API key (and the Max plan's monthly API credits)

`AUTH_MODE=api_key` is the officially recommended way to run Agent SDK apps, needs no Claude Code login, and every
Claudestra feature works with it. Since 7 October 2026 the **Max plan includes $100 a month of Claude API credits**
(Ultra, formerly Max 20x: $200), with no card needed, and they cover exactly this kind of use (Agent SDK with an API
key from the linked Console organization). Sources: support.claude.com/en/articles/17154008,
platform.claude.com/docs/en/about-claude/api-credits-for-subscribers.

1. Sign in to **claude.ai in a web browser** as the Max subscriber → **Settings → Billing → API credits → Link
   organization** (you can create the Console organization in that flow; you need 7 days on the plan). Only one
   organization can be linked. On a company **Team** plan only the Team Owner can claim; **Enterprise** gets no credits
   (ask the company admin to invite you to the company's Console organization with the Developer role instead).
2. In the Console (**platform.claude.com/settings/keys**, the old console.anthropic.com redirects there) → **Create
   key**: pick the linked organization's workspace (a key not scoped to one workspace is rejected), and expiry
   **Never** or long (it cannot be changed later; an expired key stops Claudestra).
3. `notepad .env`:
   ```
   AUTH_MODE=api_key
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   Keep the key **only in `.env`**, not as a Windows environment variable: otherwise the normal `claude` command would
   also use the key, and the Max credits do not cover interactive Claude Code ("Credit balance too low").
4. `Ctrl+C`, `npm run dev`. In a run, click a step: the Inspector shows **auth: API key**.
5. Recommended: set a monthly **spend limit** on the Console Billing page. Claudestra's `DAILY_BUDGET_USD` and run
   budgets are estimates, not a hard billing cap.

Good to know: credits refresh each billing cycle and do not roll over; when they run out, requests stop (nothing is
charged unless you buy credits or turn on auto-reload). WebSearch is billed extra ($10 per 1,000 searches). Signing in to
claude.ai and the Console works only with **Continue with Google** or an emailed link (no passwords), so you need one of
those to claim the credits or create a key.

## Meta Muse (your Meta API credit) and other OpenAI-compatible models

1. Meta's developer console → create an API key (credit on the account is used per token).
2. `notepad .env`:
   ```
   AUTH_MODE=meta
   META_API_KEY=paste-your-key-here
   META_MODEL=muse-spark-1.3
   ```
   Use the exact model id your Meta console lists (e.g. `muse-spark-1.3`, or the cheaper `muse-spark-1.3-contributor`,
   which lets Meta train on your prompts). Optionally copy Meta's prices into `META_PRICE_INPUT_PER_M` /
   `META_PRICE_OUTPUT_PER_M` so the Costs page and budgets show real dollars.
3. `Ctrl+C`, `npm run dev`. The badge shows `meta`; a step's Inspector shows `auth: meta`.

## Other providers: OpenRouter, Groq, DeepSeek, or free offline models (Ollama / LM Studio)

`AUTH_MODE=openai_compat` with a provider preset:

| Provider | `.env` | Notes |
|---|---|---|
| OpenRouter | `OPENAI_PROVIDER=openrouter`, `OPENAI_API_KEY=...`, `OPENAI_MODEL=deepseek/deepseek-chat-v3.1:free` | one key, hundreds of models, some free (`:free`) |
| Groq | `OPENAI_PROVIDER=groq`, `OPENAI_API_KEY=...`, `OPENAI_MODEL=llama-3.3-70b-versatile` | very fast |
| DeepSeek | `OPENAI_PROVIDER=deepseek`, `OPENAI_API_KEY=...`, `OPENAI_MODEL=deepseek-chat` | cheap |
| Ollama | `OPENAI_PROVIDER=ollama`, `OPENAI_MODEL=qwen3:8b` | free and offline: install from ollama.com, run `ollama pull qwen3:8b` |
| LM Studio | `OPENAI_PROVIDER=lmstudio`, `OPENAI_MODEL=<id shown in LM Studio>` | free and offline: Developer tab → Start Server |

Local models run one step at a time (they share your GPU/CPU; `MAX_CONCURRENT_STEPS` overrides). Pick a model that
supports tool calling (Qwen 3, Llama 3.1+, Mistral); 7–8B models work for small tasks, bigger is better. Any other
OpenAI-compatible server: leave `OPENAI_PROVIDER` empty and set `OPENAI_BASE_URL`. Agents use Claudestra's own
file/Bash/web tools.

**Rate limits:** when a provider says "busy" (429/503) every step waits and continues by itself (shown in the step as
"waiting … until 21:42:10"), up to `QUOTA_MAX_WAIT_SEC` (10 minutes). On Gemini's free tier set `GEMINI_RPM=10` to
avoid hitting the limit in the first place. A used-up daily quota stops the step with a clear message.

## Real AI for free: Google Gemini

1. Open **aistudio.google.com** with your Google account → **Get API key** → **Create API key**, copy it.
2. `notepad .env` and set:
   ```
   AUTH_MODE=gemini
   GEMINI_API_KEY=paste-your-key-here
   ```
3. `Ctrl+C`, then `npm run dev` (not `npm run demo`). The badge at the top shows `gemini`.

Notes: the free tier allows only a few requests per minute, so prefer the **eco** profile and small tasks; when it is
busy Claudestra waits and retries automatically. Agents use Claudestra's own file/Bash/web tools and skills; MCP apps
work only with Claude. If a model name stops working, set `GEMINI_MODEL_STRONG`, `GEMINI_MODEL_MID`, `GEMINI_MODEL_CHEAP`
in `.env` to current ids from ai.google.dev/gemini-api/docs/models.

## Where the results are

Each task writes its files into `Claudestra\workspaces\<run id>\` (the id is in the address bar after `run=`).
In the app, open the task and use the bar above **Answer** / **Files**:
- **▶ Sına / Try it** runs the generated web page in a safe preview window (served on port 8788).
- **📁 Qovluğu aç / Open folder** opens that folder in Explorer.
- **⬇ ZIP** downloads everything.
- **⬆ GitHub** pushes the files to a new or existing repository. One-time setup: on github.com go to Settings →
  Developer settings → Personal access tokens, create a token (fine-grained: *Contents* and *Administration* read and
  write for "All repositories"; or classic with the *repo* scope), then add `GITHUB_TOKEN=...` to `.env` and restart.

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
- No way to log in right now: use `AUTH_MODE=api_key` with a key from platform.claude.com/settings/keys (that also needs a login),
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
