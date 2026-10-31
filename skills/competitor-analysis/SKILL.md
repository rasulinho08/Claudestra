---
name: competitor-analysis
description: Use when comparing competitors of a product: tables of features, pricing, audience, strengths and weaknesses, each cell backed by a cited, dated source.
---
# Competitor analysis

## Before searching
Confirm the product being positioned, its target customer and geography, and the decision the analysis supports
(pricing, feature priorities, positioning). If the brief names competitors, start there; otherwise find them.

## Steps
1. **Find candidates (8-15).** Search for the problem, not just the category ("accept online payments small
   shop Baku", "kiçik biznes üçün onlayn ödəniş"). Include direct competitors, indirect ones (different product,
   same job) and substitutes (Excel, Instagram + WhatsApp, an agency). Check app stores and marketplaces too.
2. **Shortlist 4-8** that the target customer would really consider. Say why others were dropped.
3. **Collect facts from each competitor's own pages first**: pricing page, feature/docs pages, terms, changelog.
   Then add third-party evidence: public reviews (app stores, review sites), news. Save URL and date for each.
4. **Fill the tables** (below). One fact per cell; if you could not find it, write `n/a (not published)`, never
   a guess. Prices: currency, period, tax, plan name, and "as of <date>".
5. **Strengths and weaknesses**: 2-4 each, every point backed by evidence (a feature, a price, a pattern across
   several reviews with links). One angry review is not a weakness.
6. **Find gaps**: needs no competitor covers well, underserved segments, price points left open, local factors
   (Azerbaijani language UI, local payment methods, AZN pricing, local support).
7. **Recommend** 3-5 positioning or feature moves, each tied to a gap from step 6.

## Rules
- Never invent features, prices, customer counts, funding or reviews. Marketing claims from the competitor's site
  are reported as "claims" ("says it serves 10,000 shops").
- Compare like with like: same plan tier, same billing period, same currency.
- Mark confidence per row: **confirmed** (competitor's own current page), **likely** (third party), **unverified**.
- Stay factual and fair; no insults or speculation about competitors' intentions.
- Optionally also save the main table as `competitors.csv` (same columns, UTF-8) for spreadsheets.

## Output format
Write `competitor-analysis.md`:
```
# Competitor analysis: <product> (<geography>, researched <YYYY-MM-DD>)
## Summary (3-5 bullets)
## Competitors at a glance
| Competitor | Type (direct/indirect/substitute) | Audience | Starting price (as of date) | Source |
## Feature comparison
| Feature | Us (planned) | A | B | C |   (yes / no / partial / n/a, with footnote links)
## Strengths and weaknesses (per competitor, each point with a source)
## Gaps and opportunities
## Recommendations
## Sources (numbered: title, URL, publication date, accessed date)
```
