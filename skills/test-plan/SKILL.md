---
name: test-plan
description: Use when about to test a feature or app: write a short test plan (TEST-PLAN.md) with scope, test cases, edge cases and expected results, then record actual results.
---
# Test plan

Write `TEST-PLAN.md` in the workspace before running any test. Keep it to one or two screens.

## Steps
1. Read the requirements (user stories, acceptance criteria, README, the task text). Every criterion becomes
   at least one test case. If there are no written requirements, list what you assumed under **Assumptions**.
2. Define scope: what is tested, what is not (and why), and the environment (OS, browser, Node/Python version
   you actually checked with `node -v` / `python --version`).
3. Write cases: happy path first, then edge cases, then invalid input. Each case has one expected result
   that a tester can check with yes/no.
4. Mark priority: **P1** = core flow must work, **P2** = important, **P3** = nice to have.
5. Decide per case: automated (name the test file) or manual (steps a person follows).
6. Run the tests, fill **Actual** and **Status** (Pass / Fail / Blocked / Not run). Never mark Pass for a case
   you did not run.

## Edge-case checklist
- [ ] Empty: no input, empty list, empty file, first launch with no saved data.
- [ ] Boundaries: 0, 1, max length, very long text, large numbers, dates at month/year end.
- [ ] Invalid: wrong type, negative numbers, bad date format, missing required field.
- [ ] Repetition: double click, adding the same item twice, refresh in the middle of a flow.
- [ ] Persistence: data still there after reload; behaviour when storage is cleared.
- [ ] Language: Azerbaijani letters (ə, ğ, ı, İ, ş, ç, ö, ü) in input, search and sorting; decimal comma (12,50).
- [ ] Layout and access: narrow phone width, keyboard only, zoom 200% (for UI work).

## Output format
```markdown
# Test plan: <feature>
**Scope:** in: ... / out: ...
**Environment:** Windows 11, Edge; Node 22.x
**Assumptions:** ...

| ID | Pri | Case | Steps / input | Expected | Actual | Status |
|----|-----|------|---------------|----------|--------|--------|
| TC1 | P1 | Add item | Type "süd", press Add | List shows 1 item "süd" | | Not run |
| TC2 | P2 | Empty name | Press Add with empty field | Error "Name is required", nothing added | | Not run |
| TC3 | P2 | Reload keeps data | Add 2 items, reload page | Both items still listed | | Not run |

## Summary
Passed X / Failed Y / Blocked Z / Not run W
## Defects
- TC2: expected error message, actual: empty item added. Severity: medium. Fixed? no.
## Open questions
- ...
```

## Rules
- Expected results come from the requirements, not from what the code currently does.
- Use realistic but invented sample data; never real personal data or secrets.
- Keep IDs stable so the coder and reviewer can refer to "TC2".
- Hand failed cases back with exact steps to reproduce.
