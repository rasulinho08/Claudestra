---
name: refactoring-safely
description: Use when restructuring existing code without changing what it does: small behaviour-preserving steps guarded by tests, knowing when to stop and how to describe the change.
---
# Refactoring safely

A refactor changes structure, never behaviour. If behaviour must change too, do it in a separate step.

## Before you start
1. State the goal in one sentence: "split `report.js` so parsing can be tested on its own".
2. Run the existing tests (`npm test`, `node --test`, `python -m unittest`) and record the result.
   Already failing? Report that first; do not refactor on a red baseline.
3. No tests for the code you will touch? Write **characterisation tests** first: call the code with
   realistic inputs and assert on whatever it returns today, even if it looks odd.
   ```js
   import { test } from "node:test";
   import assert from "node:assert/strict";
   import { formatTotal } from "./report.js";
   test("formatTotal keeps current output", () => {
     assert.equal(formatTotal([1.5, 2]), "3.50 AZN");
   });
   ```
4. Find every caller (search the workspace for the name) so you know what depends on it.

## The loop (repeat)
1. Make **one** small change: rename, extract function, inline, move file, replace magic number with a
   named constant, remove duplication, simplify a condition.
2. Run the tests. Green: keep it (commit if the workspace uses git). Red: undo the step, do not debug forward.
3. Keep public names, function signatures, file outputs, CLI flags and error messages unchanged unless the
   task asks; if one must change, update every caller in the same step.

## Do not
- Mix refactoring with new features, bug fixes or formatting-only churn across the whole file.
- Rewrite from scratch when small steps would do.
- Change behaviour you think is a bug; note it and report it instead (it may be relied on).
- Add dependencies or new abstractions "for later".

## When to stop
- The stated goal is met, or
- the next step would need behaviour changes or a design decision the task did not ask for, or
- tests cannot cover the area and the risk is no longer small: stop and say what is untested.

## Describe the change
```
## Refactor: <goal>
Steps: 1) extracted parseRows() from report.js  2) renamed tmp -> rowCount  3) moved helpers to utils.js
Behaviour: unchanged; tests before: 12 passed, after: 14 passed (2 characterisation tests added)
Callers updated: <files> (or "none")
Noticed but not changed: <suspected bugs, follow-ups>
```
