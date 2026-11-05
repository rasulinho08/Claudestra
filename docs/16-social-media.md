# 16. Social media team (Instagram, LinkedIn, X)

Two agents run the company's social media; a person approves every post before it goes out.

| Agent | Does | Never |
|---|---|---|
| **Community Manager** (`community-manager`) | picks weekly topics from real work and cited news, writes `social/plan.md` (content-calendar skill), drafts community replies | posts or replies itself |
| **Content Maker** (`content-maker`) | writes a separate text per platform, makes PNG cards from brand SVG templates (brand-card skill) or AI pictures, publishes through Postiz | publishes without approval, invents facts |

Flow: *Workflows → Templates → Weekly social media*, or a message in Chat ("LinkedIn və Instagram üçün GRC360
Framework Library haqqında post hazırla"). A schedule (Workflows → Triggers, e.g. Monday 09:00) makes it weekly.

```
Community Manager: social/plan.md ─► Content Maker: social/<date>-<slug>/posts.md + card-*.png
  ─► ⏸ approval of mcp__social__create_post (text and image paths are shown) ─► Postiz ─► Instagram / LinkedIn / X
```

## Built-in apps (`apps/server/mcp/`)
- **media** (always available, free): `render_png` turns the SVG card into PNG locally (Azerbaijani letters, system
  fonts or `.ttf` files in a `fonts/` folder); `generate_image` makes a picture with Gemini when `GEMINI_API_KEY` is
  set (free tier; prompts may be used by Google, so nothing confidential; at most `MEDIA_MAX_IMAGES` per step).
- **social** (needs Postiz): `list_channels` (read-only) and `create_post` (always asks a person, even in auto mode).
  Checks before sending: connected account, text length (X 280, LinkedIn 3,000, Instagram 2,200), Instagram has an
  image. `when` = `draft` (default: lands in Postiz for a last look), `now`, or a date-time to schedule.

Both servers only read and write files inside the run workspace. Social network passwords never reach Claudestra:
the accounts are connected inside Postiz, and `POSTIZ_API_KEY` stays on the server (not passed to agents' shells).

## Setup
1. **Brand** (once): Agents → Content Maker → Profile & training → instructions, e.g. "Brand: STRATIVU. Colours:
   background #0b1220 → #13203a, accent #22d3ee, text #ffffff. Font: Inter. Tone: expert, calm, no hype. Hashtags:
   #Strativu plus 2–4 topical." Optional: a project folder with `brand/logo.png` and `fonts/*.ttf`.
2. **Postiz** (for publishing). Cloud (postiz.com): 7-day trial, then from $29/month (5 channels; Instagram, LinkedIn
   page and X use 3). Connect the accounts in Postiz:
   - Instagram: a **professional** (Business or Creator) account; the "Instagram" option also needs a linked
     Facebook Page, "Instagram Standalone" does not.
   - LinkedIn: your profile or the company page (you must be a page admin).
   - X: the company account.
   Then Postiz → Settings → **Public API** → copy the key into `.env`: `POSTIZ_API_KEY=...` (leave `POSTIZ_URL` empty
   for the cloud).
   Self-hosting Postiz (Docker) is free but you create your own Meta, LinkedIn and X developer apps, and Instagram
   publishing needs Meta app review; set `POSTIZ_URL=https://your-domain/api/public/v1`.
3. **AI pictures** (optional): free key at aistudio.google.com/apikey → `GEMINI_API_KEY=...` (works with any
   `AUTH_MODE`). Without it the agent uses cards only.
4. Restart Claudestra. The startup line lists `media` and `social` without `missing_secret`.

Without Postiz the workflow still runs: the last step writes `social/to-post.md` with the texts and image paths to
post by hand.

## Safety
- `mcp__social__create_post` matches the never-auto rule `mcp__*__create_*`: approval in every mode, and "approve for
  this run" does not apply to it.
- Facts and numbers come from the brief or a cited source; posts with `[FACT NEEDED]` are skipped.
- Internal data (client names, internal numbers) only with explicit permission in the brief.
