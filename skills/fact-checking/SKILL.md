---
name: fact-checking
description: Use when verifying claims in a draft, report or brief against primary sources, dating each fact, flagging uncertainty and never filling gaps with invented facts.
---
# Fact-checking

## Steps
1. **Extract claims.** Go through the text and list every checkable statement: numbers, dates, names, titles,
   quotes, rankings ("largest", "first"), causal claims, versions, prices, legal statements. Number them C1, C2...
   Skip pure opinions, but flag opinions written as facts.
2. **Prioritise.** Check first what would cause harm or embarrassment if wrong: money, health, law, named people,
   headline numbers.
3. **Find the primary source** for each claim: the official statistics office, the law or regulation text, the
   company's own filing or press release, the original study (not an article about it), official docs or release
   notes, the person's own published statement. Secondary sources (news, Wikipedia, blogs) lead you to the primary
   one; cite them only if no primary source exists, and mark the claim **likely** at best.
4. **Compare exactly.** Check the number, unit, currency, year, geography and wording. "Up to 40%" is not "40%";
   "Baku" is not "Azerbaijan"; a 2019 figure is not "current".
5. **Date it.** Record the source's publication date and your access date. Facts that change (prices, versions,
   officeholders, laws, exchange rates) need "as of <date>".
6. **Give a verdict** per claim:
   - **Correct**: primary source matches.
   - **Partly correct**: right in substance, wrong in a detail (give the fix).
   - **Incorrect**: source contradicts it (give the correct value with source).
   - **Outdated**: was true, newer data differs.
   - **Unverified**: no reliable source found; say what you searched.
7. **Propose a fix** for every non-correct claim: corrected wording, softer wording ("about", "according to X"),
   or removal.

## Rules
- Never fabricate a source, URL, quote, date or number. "Unverified" is an acceptable result; a guess is not.
- A claim confirmed only by sources that copy each other counts as one source.
- Quotes must match the original word for word; translated quotes (e.g. Azerbaijani to English) say "translated".
- For Azerbaijani sources, keep the original title and add an English gloss; check names and letters ə ğ ı ö ü ş ç.
- Do not edit the original file unless asked; write the report next to it.
- If you have no web access, check only against files in the workspace and say so at the top.

## Output format
Write `fact-check.md`:
```
# Fact-check: <document> (checked <YYYY-MM-DD>)
Summary: 12 claims - 7 correct, 2 partly correct, 1 incorrect, 1 outdated, 1 unverified.

| # | Claim (quoted) | Verdict | Evidence (source URL, date) | Suggested fix |
|---|----------------|---------|-----------------------------|---------------|
| C1 | "Founded in 2015" | Incorrect | [company.az/about](https://...) (2024-03-01): 2016 | "Founded in 2016" |

## Notes (searches tried for unverified claims, conflicting sources)
```
