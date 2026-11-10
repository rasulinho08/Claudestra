# 18. Telegram bot and per-agent budgets

## Telegram bot: the company in your phone
`apps/server/src/telegram.ts`. The bot uses long polling (`getUpdates`), so it works on a home PC without a public
address or webhook. It starts only when `TELEGRAM_BOT_TOKEN` is set.

Setup:
1. In Telegram open **@BotFather**, send `/newbot`, choose a name; copy the token into `.env`:
   `TELEGRAM_BOT_TOKEN=123456:ABC...`
2. Start Claudestra and write anything to your new bot. It answers with your **chat id**.
3. Put the id in `.env`: `TELEGRAM_ALLOWED_CHATS=123456789` (several ids: comma-separated), restart.
4. Optional: `TELEGRAM_LANG=az` (default) or `en` for the bot's own messages.

| You write | What happens |
|---|---|
| any text | the team starts that task; the answer comes back when it is done |
| `/mission 7 <goal>` | a mission (docs/17) for 7 days, a work session every 2 hours |
| `/status` | running tasks, missions, how many approvals wait |
| `/missions`, `/pause 1`, `/resume 1`, `/stop 1` | list and control missions by their number |
| `/cancel` | stops tasks started from this chat |
| `/id` | this chat's id |

When an agent needs approval, every allowed chat gets a message with **Approve / Reject** buttons (plans get a link:
they are read in the app). Mission endings and failures are announced too.

Safety:
- Chats not in `TELEGRAM_ALLOWED_CHATS` only ever get their chat id back; nothing is started for them.
- Allowed chats act as the **owner** (they can approve shell commands and publishing). List only people you would
  give the owner role, and keep the token secret: anyone with the token can read the bot's messages.
- The token is never passed to agents (`secret-env.ts`). Tasks from Telegram use the default approval mode, so
  never-auto actions (publishing, pushing) still wait for a button press.
- Voice messages are not transcribed; dictate with the phone keyboard's microphone instead.

## Per-agent monthly budget
`apps/server/src/budgets.ts`, table `agent_budgets`, `PUT /api/agents/:id/budget` (owner only), Agents → Profile.

The owner may cap what one agent spends in a calendar month. `GET /api/agents` reports `budget: { monthlyUsd,
spentUsd, over }` (spend = this month's step costs of that agent). When the cap is reached, the agent's next step
fails immediately with a message that names the limit; the model is not called. The CEO decides what to do next as
with any failed step (retry is pointless, so it continues without it or stops). The CEO itself has no cap, because
nothing could be planned without it. The cap resets on the 1st, or when the owner raises it. It works together with
the run, step, daily and monthly limits of docs/11; it can only stop spending sooner.
