---
name: python-testing
description: Use when writing or running Python tests: unittest from the standard library by default, pytest only if it is already installed. Covers layout, running and reporting.
---
# Python testing (unittest first)

## Check what is available (do not install anything)
- `python -m unittest --help` always works (use `python3` on Linux/macOS if `python` is missing, `py` on Windows).
- pytest only if this prints a version: `python -c "import pytest; print(pytest.__version__)"`.
  If it fails, use unittest. Never run `pip install`. unittest-style tests also run under pytest.

## Layout
```
project/
  calc.py              # code under test: functions, no input()/print() at import time
  tests/
    __init__.py        # empty file, makes discovery reliable
    test_calc.py       # files and methods start with test
```
- Put script code under `if __name__ == "__main__":` so importing the module runs nothing.
- Keep logic in functions that take arguments and return values; keep `input()`, `print()` and file paths
  at the edges so they are easy to replace in tests.

## Test file template
```python
import unittest
from calc import parse_amount

class TestParseAmount(unittest.TestCase):
    def test_plain_number(self):
        self.assertEqual(parse_amount("12.50"), 12.5)

    def test_comma_decimal(self):
        self.assertEqual(parse_amount("12,50"), 12.5)

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            parse_amount("")

if __name__ == "__main__":
    unittest.main()
```

## Running (from the project root)
- All tests: `python -m unittest discover -s tests -v`
- One file / one test: `python -m unittest tests.test_calc -v` / `python -m unittest tests.test_calc.TestParseAmount.test_empty_raises`
- With pytest (if present): `python -m pytest -q`

## What to test (per function)
- [ ] Normal case with realistic data.
- [ ] Empty and missing input: `""`, `[]`, `None`, missing CSV column, empty file.
- [ ] Boundaries: 0, 1, negative, very large, first/last item, leap day.
- [ ] Invalid input raises the documented error (`assertRaises`) with a useful message.
- [ ] Floats with `assertAlmostEqual(a, b, places=6)`, never `assertEqual`.
- [ ] Azerbaijani text (ə, ğ, ı, İ, ş, ç, ö, ü) when the code reads files, sorts or changes case: open files
  with `encoding="utf-8"`; note `"I".lower()` is `"i"`, not `"ı"`.

## Useful tools from the standard library
- Temp files: `tempfile.TemporaryDirectory()` in `setUp`, cleaned in `tearDown`; never write into real data folders.
- Fake input/output: `unittest.mock.patch("builtins.input", return_value="5")`, `io.StringIO` +
  `contextlib.redirect_stdout` to capture `print`.
- Time: pass `today` as an argument, or `mock.patch` the function that returns the date.
- Shared fixtures: `setUp` (each test) and `setUpClass` (once per class).

## Rules
1. One behaviour per test method; the name says it (`test_comma_decimal`).
2. No network, no real API keys, no dependence on test order.
3. Do not delete or loosen a failing test to get green; fix the code or report the failure.

## Report
Quote the last lines of the run (`Ran N tests`, `OK` or `FAILED (failures=X, errors=Y)`). For each failure:
test name, expected vs actual, and whether you fixed it or left it open.
