---
name: brand-card
description: Use when a social media post needs an image: on-brand SVG cards (Instagram 1080x1350, LinkedIn/X 1200x627) filled from templates and rendered to PNG with mcp__media__render_png; brand colours, fonts, logo, text fitting and checks.
---
# Brand cards for posts

Text, numbers and logos belong on a card you control, not in an AI picture (AI pictures misspell words and invent
logos). Cards are SVG files filled from the templates in this skill and rendered to PNG.

## Brand settings
Take them, in this order, from: the agent's training instructions, a `brand/brand.md` file in the workspace (or the
linked project), the task. If nothing is given, use the neutral defaults and say so in the report.

| Placeholder | Meaning | Neutral default |
|---|---|---|
| `{{BG}}`, `{{BG_2}}` | background gradient (dark → slightly lighter) | `#0f172a`, `#1e293b` |
| `{{ACCENT}}` | brand accent colour | `#38bdf8` |
| `{{TEXT}}` | text colour (high contrast with BG) | `#ffffff` |
| `{{FONT}}` | font family | `Arial, Helvetica, sans-serif` |
| `{{BRAND}}` | company name in capitals (or a logo image) | from the brief |

Logo: if `brand/logo.png` (or .svg) exists, copy it next to the card and replace the brand text with
`<image href="logo.png" x="90" y="90" height="64"/>` (relative path; only workspace files work).
Brand font: put .ttf/.otf files in a `fonts/` folder of the workspace and use the family name in `{{FONT}}`.

## Steps
1. Pick the template: `card-portrait.svg` (Instagram feed, 1080x1350) and/or `card-wide.svg` (LinkedIn and X,
   1200x627). Read it with Read from `.claude/skills/brand-card/`.
2. Write the copy for the card: `{{KICKER}}` (2–4 words, category such as "GRC · İPUCU"), `{{TITLE_1..3}}` (the
   post's main promise, broken into lines yourself: about 18 characters per line on portrait, 24 on wide),
   `{{BODY_1..3}}` (portrait only, optional), `{{FOOTER}}` (site or handle), `{{CTA}}` (2–3 words).
3. Replace every placeholder. Delete `<tspan>`/`<text>` lines you leave empty. Escape `&` as `&amp;`, `<` as `&lt;`.
4. Save as `social/<date>-<slug>/card-instagram.svg` / `card-wide.svg`, then call `mcp__media__render_png`
   with the same name ending in `.png`.
5. Check: no `{{` left (Grep), no line wider than the card (shorten the words rather than shrinking below 56px
   titles), contrast is strong, the text matches the post, numbers have a source.

## Variations
- Quote card: KICKER = person's role, TITLE lines = the quote in « », FOOTER = name. Only real quotes with consent.
- Number card: TITLE_1 = the number (e.g. "31 xal"), TITLE_2–3 = what it means. Only real numbers.
- Carousel (Instagram/LinkedIn): one card per slide, same layout, slide counter "1/5" in the CTA place.
- Background picture: `mcp__media__generate_image` (aspect 4:5 or 16:9), then add
  `<image href="background.png" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" opacity="0.35"/>`
  right after the background rect so text stays readable.
