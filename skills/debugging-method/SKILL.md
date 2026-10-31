---
name: debugging-method
description: Use when something fails, crashes or gives wrong output: reproduce, isolate, hypothesise, verify, then report the root cause instead of guessing at fixes.
---
# Debugging method

Do not change code until you can make the bug happen on demand. One hypothesis at a time; evidence over hunches.

## 1. Reproduce
1. Write down: exact command or steps, input, expected result, actual result (copy the real error text).
2. Run it yourself in the workspace and confirm you see the same failure. If you cannot, say so and stop
   guessing; ask for the missing input or steps instead.
3. Note the environment that matters: `node --version`, `python --version`, OS (Windows paths and line
   endings `\r\n` cause many "works on my machine" bugs).

## 2. Read the stack trace
- Read the **message first**, then the **first frame that is in workspace code** (skip `node:internal`,
  `site-packages`, `<anonymous>`). That line is where to start, not necessarily where the bug is.
- Node: frames read top = most recent. Python: the **last** line is the error, frames above lead to it.
- `Caused by` / `During handling of the above exception` means there are two errors; the first is the real one.
- Common meanings: `undefined is not a function` / `AttributeError` = wrong type or missing value upstream;
  `ENOENT` / `FileNotFoundError` = wrong path or working directory; `KeyError` / `undefined` field = data shape
  differs from what the code assumes.

## 3. Isolate (minimal repro)
1. Cut the input in half until the failure disappears; the last half that fails holds the trigger.
2. Remove unrelated code paths, options and files until a few lines still fail.
3. Save it as `repro.js` / `repro.py` (or a failing test) that prints the wrong value or throws.
   ```js
   // repro.js - run: node repro.js
   import { parsePrice } from "./src/price.js";
   console.log(parsePrice("1,50")); // expected 1.5, got NaN
   ```
4. Add temporary `console.log` / `print` of the inputs and intermediate values at the boundary you suspect.
   Remove them before you finish.

## 4. Hypothesise and verify
1. State one hypothesis as a testable sentence: "parsePrice fails because it does not accept a comma decimal".
2. Predict what you will see if it is true, then run the check. Confirmed or refuted, write it down.
3. Refuted? Pick the next hypothesis; do not stack speculative fixes.
4. Fix the cause, not the symptom (no blanket `try/catch`, no `|| 0` that hides bad data).
5. Turn the repro into a regression test (`node --test`, `python -m unittest`) that failed before and passes now.
6. Re-run the full test suite to check you broke nothing else.

Locale traps worth checking for Azerbaijani data: comma decimals (`1,50`), `dd.mm.yyyy` dates, and
case mapping of `İ/i` and `I/ı` (`"I".toLowerCase()` is not `ı`; use `toLocaleLowerCase("az")`).

## 5. Report
```
## Bug: <one-line symptom>
Reproduce: <command + input>
Expected / actual: <...> / <exact error or output>
Root cause: <file:line, what was wrong and why it produced the symptom>
Fix: <what changed>
Verified by: <test name or command, and its result>
Not verified / open: <anything you could not check>
```
If you could not find the cause, report what you ruled out and the best remaining hypothesis. Never claim
a fix works without having run it.
