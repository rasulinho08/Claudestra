---
name: grc-research-doc
description: Use when researching a GRC module or feature (frameworks, controls, risks, compliance packages) and writing the explanatory document for the product and the backend/frontend developers.
---
# GRC research document

A research document has two readers: the researcher (to fully understand the topic) and the developers (to implement it). It explains how the thing works, not only what exists.

## Steps
1. **Question**: write the research goal and 3–6 concrete research questions (e.g. "How do Framework, Version, Requirement and Control relate?").
2. **Sources**: study at least three real tools (for example Eramba, CISO Assistant, ServiceNow IRM, Archer, OneTrust, Drata, Vanta) and primary standards (ISO 27001, NIST CSF, SOC 2, COBIT, GDPR) where relevant. Keep the URL and date of every source.
3. **Compare**: a table "how each tool does it" with the same columns for every tool (concept, data model, workflow, import/export, limits).
4. **Explain the logic**: step-by-step workflow, the entities and their relations (write a small data model: entity, fields, keys, relations), business rules, edge cases.
5. **Proposal for our product**: what to build, data structures, API shape if useful, how it integrates with existing modules, options with trade-offs. Mark it **Proposal (not approved)**.
6. **Open questions** for Product Management.

## Document format (Markdown, Azerbaijani unless asked otherwise)
```
# <Mövzu> — araşdırma
## Xülasə (5–7 cümlə)
## Məqsəd və suallar
## Bazar alətlərində necə işləyir (müqayisə cədvəli)
## İşləmə məntiqi (addım-addım)
## Data modeli (cədvəl: entity | sahələr | əlaqələr)
## Biznes qaydaları və kənar hallar
## GRC360 üçün təklif (təsdiqlənməyib)
## Açıq suallar
## Mənbələr (link + tarix)
```
Also write the same content as a print-ready `.html` (simple styles, tables) so it can be saved as PDF from the browser.

## Rules
- Every comparison or claim has a source; label anything unverified as "fərziyyə".
- Research results are findings, not approved facts or decisions; never change existing functional requirements.
- Prefer concrete examples (a real framework, a real control ID) over abstractions.
