---
name: market-research
description: Use when researching a market or product idea with web search: demand and size signals, customer segments, competitors, sources with URLs and dates, and confidence levels.
---
# Market research

## Before searching
Write down (or list as **Open questions** if the brief does not say): the product idea in one sentence, the
geography (e.g. Azerbaijan, Baku only, CIS, EU), the customer type (consumers, small businesses, enterprises),
the decision this research supports (build or not, which segment first, pricing) and the time budget.

## Steps
1. **Frame 3-6 questions** the report must answer, e.g. "Who pays for this today, and how much?"
2. **Search in passes**, one question at a time. Use several phrasings and, for local markets, the local language
   too (Azerbaijani: "onlayn mağaza Bakı", Russian where commonly used). Note the date you searched.
3. **Collect sizing signals**, not one magic number: official statistics (national statistics office, central
   bank, World Bank, Eurostat), number of businesses in the category, public company reports, job postings,
   app store listings, search interest, prices people already pay. Record each with URL and publication date.
4. **Estimate size bottom-up** when no reliable figure exists: `customers x share who buy x price per year`.
   Show every input, its source, and mark assumptions as assumptions. Give a range (low / base / high), never a
   single precise figure you cannot source.
5. **Describe customer segments**: who they are, the problem, current workaround, willingness to pay (evidence
   only: published prices, reviews, forum complaints with links).
6. **List competitors and substitutes** (including "spreadsheets", "WhatsApp", "doing nothing"). For a deep
   comparison use the `competitor-analysis` skill.
7. **Find trends and risks**: regulation, payment or delivery constraints, seasonality, recent entries or exits.
8. **Rate confidence** for each finding: **confirmed** (primary source), **likely** (credible secondary
   source), **unverified** (single weak source or your inference). Follow the `source-citation` skill.

## Rules
- Never invent statistics, market sizes, growth rates, quotes or URLs. If nothing was found, write "No data found"
  and say what you searched.
- Prefer sources from the last 2-3 years; flag older ones as "(dated: 2019)".
- Keep the currency and year of every figure (e.g. "AZN 2024"); do not mix currencies without stating the rate
  and its date.
- Separate facts from your interpretation: put opinions under **Analysis**.
- Without web access, say so at the top and limit the report to a research plan plus what the workspace contains.

## Output format
Write `market-research.md`:
```
# Market research: <idea> (<geography>, searched <YYYY-MM-DD>)
## Summary (5 bullets max, each with a confidence label)
## Questions
## Market size signals   (table: Signal | Value | Source URL | Date | Confidence)
## Size estimate         (formula, inputs, low / base / high)
## Customer segments
## Competitors and substitutes
## Trends and risks
## Analysis and recommendation
## Gaps / Open questions (what could not be found, what to ask real customers)
## Sources (numbered list: title, URL, publication date, accessed date)
```
