# 15. Team server: one address, everyone's own agent

One Claudestra for the whole team, reachable at one address (e.g. `https://team.example.com`).
Every person logs in with their own token and has **their own agent** (their name, working style, skills, tools,
training). They can give a task straight to their agent, or send it to **General**, where the CEO splits it over the
whole team.

## How it works
| Piece | Where |
|---|---|
| Login and roles (owner / operator / viewer) | Users page, `npm run user` (docs/12) |
| Person → agent link | `users.agent_id`; Users page or `npm run user -- add NAME operator AGENT_ID` / `link NAME AGENT_ID` |
| "My agent" | composer **Who does it** (default: your agent), HQ card **My agent** |
| Direct task | `POST /api/runs {agentId}`: a one-step plan for that agent, no CEO planning (run mode `direct`) |
| General task | no `agentId`: the CEO plans with the whole roster (unchanged) |
| Own-agent editing | a person may change **their own** agent's name/style (`PUT /api/agents/:id/persona`), skills (`PUT /api/agents/:id/skills`) and training; tools, approvals and the agent file stay owner-only |
| Agent profiles | the **Agent anketi** form collects each person's work, skills and GitHub skills; Claude turns each answer into an agent |

## Safety on a shared server
- `PUBLIC_URL` must be set when people reach the server from outside; then login is required (the server refuses to
  start without it), the public host name is allowed, and requests through the tunnel/proxy never count as
  "this computer" (no "Open folder", hooks need `HOOKS_SECRET`).
- **Auto-approve** is owner-only; teammates use manual or smart.
- On a shared server only the **owner** can allow shell (Bash) commands: they run on the host. Prefer Docker on a
  server rather than your own PC, so agents' commands stay inside the container.
- Agents never see server secrets (`GITHUB_TOKEN`, `AUTH_TOKEN`, app keys…).
- Model costs are shared: set `DAILY_BUDGET_USD` / `MONTHLY_BUDGET_USD`, and the model prices
  (`META_PRICE_INPUT_PER_M`, `META_PRICE_OUTPUT_PER_M`) so the caps count real dollars.

## Option A (free): your PC + Cloudflare Tunnel
1. `.env` (add to what you have):
   ```
   AUTH_TOKEN=<a long random string: this is the owner's login>
   PUBLIC_URL=https://<your address>
   DAILY_BUDGET_USD=5
   ```
2. Build once and start the single-port server (no Vite):
   ```cmd
   npm run build
   npm start
   ```
3. Install the tunnel (Windows): `winget install --id Cloudflare.cloudflared`
   - **Quick test** (free, no account, new random address each time):
     `cloudflared tunnel --url http://localhost:8787` prints `https://<random>.trycloudflare.com`;
     put that in `PUBLIC_URL` and restart `npm start`.
   - **Own domain** (free Cloudflare account, your domain on Cloudflare): create a named tunnel in Cloudflare
     Zero Trust → Networks → Tunnels, point `team.yourdomain.com` to `http://localhost:8787`, run the connector
     it shows; set `PUBLIC_URL=https://team.yourdomain.com`.
4. Users: open the address, log in with `AUTH_TOKEN`, **Users** → add each person (role *operator*) and pick their
   agent; send each person their token privately.
5. "Try it" previews need their own public host: add a second tunnel hostname to `http://localhost:8788` and set
   `PREVIEW_URL=https://preview.yourdomain.com`; without it the button is hidden for remote users.

The PC must stay on for the team to use it.

## Option B: a small server with Docker
```bash
git clone https://github.com/rasulinho08/claudestra && cd claudestra
cp .env.example .env   # set AUTH_MODE + key, AUTH_TOKEN, PUBLIC_URL, budgets
docker compose up -d --build
```
Ports are bound to 127.0.0.1; put Caddy/nginx (HTTPS) or a Cloudflare Tunnel in front. Data, run folders, projects,
agents and skills are volumes, so `git pull && docker compose up -d --build` keeps them.
