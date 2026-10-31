---
name: social-media-posts
description: Use when writing posts for Instagram, LinkedIn, X, Facebook or Telegram: platform length limits, hooks, hashtags, CTA and A/B variants, incl. Azerbaijani audiences.
---
# Social media posts

## Before writing
Get from the brief (or list as **Open questions**): goal (awareness, clicks, sign-ups, sales), audience,
platforms, language(s), link/offer, tone, real facts and proof you may use. Never invent numbers, quotes,
reviews, awards or customer names. Unknown facts become `[FACT NEEDED: ...]` placeholders.

## Platform limits and habits (check against the platform's help page if the client cares about exact limits)
| Platform | Hard limit (approx.) | Visible before "more" | Hashtags | Notes |
|---|---|---|---|---|
| Instagram | 2,200 chars caption | ~125 chars | 3-5 relevant (max 30) | Links in captions are not clickable: say "link in bio" |
| LinkedIn | 3,000 chars | ~200 chars | 3-5 | Professional, first person, short lines, link can go in first comment |
| X | 280 chars (free account) | all | 0-2 | One idea; threads = numbered posts, each standing alone |
| Facebook | very long allowed | ~250 chars | 0-3 | Conversational, questions work, link previews are fine |
| Telegram | 4,096 chars text, 1,024 chars media caption | all | 0-3 | Channel style, bold headline line, Markdown-like formatting |
Count characters with: `node -e "console.log([...process.argv[1]].length)" "post text"` (counts ə, ş, emoji correctly).

## Steps
1. Write the **hook** first: the first line must work alone before the "more" cut. Use one of:
   a concrete result, a question the reader has, a surprising but true fact, a mistake to avoid, "how to X in Y".
2. **Body**: one idea per post, short lines (1-2 sentences), blank lines between, 0-3 emoji only if the brand uses them.
3. **CTA**: one clear action matching the goal: "Comment 'demo' and we'll send it", "Register: <link>", "Save this post".
4. **Hashtags**: mix of 1 branded + 2-4 topical; no hashtag stuffing, no unrelated trending tags. CamelCase multi-word
   tags (#SmallBusiness) for screen readers.
5. **Adapt** per platform; do not paste the same text everywhere. Trim for X, expand context for LinkedIn.
6. **Visual note**: suggest image/video idea and alt text (1 sentence describing the image).
7. Check: length within limit, link present where needed, no claims without a source, spelling of names.

## Azerbaijani audience
- Write natively in Azerbaijani Latin (ə ğ ı ö ü ş ç), use formal **siz** for brands unless the brand is casual.
- Instagram, Facebook and Telegram are widely used in Azerbaijan; LinkedIn for B2B/hiring. Use the platforms the
  client actually names.
- Hashtags can be bilingual: #Bakı #Azərbaycan plus English topical tags. Avoid ASCII-only spellings (#Baki) unless the
  client already uses them.
- Prices as `25 AZN` or `25 ₼`; dates as `15.11.2026` or `15 noyabr`. Respect holidays (Novruz, Ramazan/Qurban
  bayramı, 28 May, 9 Noyabr) only if the client asks for a holiday post; check dates for the given year.
- If both AZ and EN/RU versions are needed, write each natively, not word-for-word.

## Variants
For each platform give 2 variants (A/B) that differ in hook angle only, mark one as recommended with a one-line
reason, and say what to compare (saves, link clicks, comments).

## Output format
Write `social-posts.md`:
```
# Social posts: <topic>
## Instagram
### Variant A (recommended)  - 412 chars
<text>
Hashtags: ...
Visual: ... | Alt text: ...
### Variant B - ...
## LinkedIn / ## X / ## Facebook / ## Telegram (only the requested ones)
## Posting notes (best link placement, schedule suggestion if asked)
## Assumptions / Open questions
```
