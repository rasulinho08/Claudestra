---
name: landing-page-copy
description: Use when writing or rewriting copy for a landing page: hero, benefits, proof, FAQ and call to action, with headline and CTA variants for testing.
---
# Landing page copy

## Before writing
Collect from the brief (or list as **Open questions** if missing): product, audience, the one action you want
(sign up, book a call, buy), the main problem it solves, price/offer, real proof available, language(s).
If the page is for Azerbaijani readers, write the Azerbaijani version natively (not a word-for-word translation),
check the letters ə ğ ı ö ü ş ç, and keep the CTA short in both languages.

## Structure (in this order)
1. **Hero**: headline (max ~10 words, the outcome for the reader), subheadline (1-2 sentences: what it is, for whom,
   how), primary CTA button (verb + result: "Start free trial", not "Submit"), one line that removes risk
   ("No card needed") only if true.
2. **Problem**: 2-3 sentences in the reader's words about the pain or goal.
3. **Benefits**: 3-5 items. Each = short bold benefit + one sentence with the feature that delivers it.
   Benefit, not feature: "Get paid 2x faster" beats "Automated invoicing" (only if the 2x is a real number).
4. **How it works**: 3 numbered steps, each one line.
5. **Proof**: only real material from the client: quotes with name/role and permission, client logos, numbers with
   a source. If there is none, write `[PROOF NEEDED: e.g. customer quote]` placeholders. Never invent testimonials,
   ratings, user counts or awards.
6. **Offer / pricing**: what they get, price, what happens after they click.
7. **FAQ**: 4-6 real objections (price, time, trust, cancellation, support, data). Answers 1-3 sentences.
8. **Final CTA**: restate the outcome + same primary CTA. One primary action across the page.

## Style rules
- Second person ("you"), active voice, short sentences, plain words; read it aloud.
- Specific beats clever: numbers, time frames, named outcomes, but only verified ones.
- No superlatives you cannot prove ("best", "#1"); no fake urgency or countdowns.
- Scannable: one idea per paragraph, max ~3 lines; headings say the point.
- Button text and link text must make sense out of context (accessibility).

## Variants
Give 3 headline variants, each from a different angle, plus 2 CTA variants:
- A **Outcome**: "Launch your online store this weekend"
- B **Pain**: "Stop losing orders in WhatsApp chats"
- C **Audience**: "The online store built for Baku craft makers"
Mark one as recommended and say why in one line. Suggest what to measure (click rate on the primary CTA).

## Output format
Write `landing-copy.md`:
```
# Landing copy: <product>
## Hero
Headline: ...
Subheadline: ...
CTA: ...
## Problem / ## Benefits / ## How it works / ## Proof / ## Offer / ## FAQ / ## Final CTA
## Variants (headlines A-C, CTAs 1-2, recommendation)
## Meta (SEO title <= 60 chars, description <= 160 chars)
## Assumptions / Open questions
```
If a second language is needed, repeat the same sections under `# AZ` (or `# EN`) in the same file.
