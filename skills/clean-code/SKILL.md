---
name: clean-code
description: House rules for writing small, readable, working code in the run workspace. Use whenever you write or edit code.
---
# Clean code rules

1. Prefer the standard library; add a dependency only when the task clearly needs it, and say why.
2. Small functions with one job; names say what a thing is or does.
3. Handle the error cases the task implies (empty input, missing file, bad type) with clear messages.
4. No dead code, commented-out code, TODOs or placeholder values for requested behaviour.
5. Add a short usage example (README section or docstring) for anything a person will run.
6. If you can run a quick check (a test file, `node file.js`, `python file.py`), do it and quote the result.
