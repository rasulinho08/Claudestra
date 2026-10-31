---
name: data-cleaning-csv
description: Use when you must read, fix or normalise a CSV file (encodings, separators, dates, numbers, duplicates, blanks) with plain Python csv or Node, and leave a cleaning log.
---
# Cleaning CSV without pandas

## Rules
1. Never edit the source file. Read `data/raw.csv`, write `data/clean.csv` plus `data/cleaning-log.md`.
2. Change only what you can justify; every change gets a line or a count in the log. Do not fill gaps with guessed values.
3. Use Python `csv` (preferred) or Node `fs` + a small parser. No pandas, no npm/pip installs.

## Steps
1. **Sniff the file.** Look at the first bytes and lines before parsing:
   `python -c "b=open('data/raw.csv','rb').read(400);print(b[:3]==b'\xef\xbb\xbf' and 'BOM' or 'no BOM');print(b)"`
2. **Encoding.** Open with `encoding='utf-8-sig'` (strips the Excel/Windows BOM). If it raises `UnicodeDecodeError`, try `cp1254` (Turkish/Azerbaijani Windows), then `cp1251` (Cyrillic), then `latin-1`; log which one worked. Check that Azerbaijani letters (ə ğ ı ö ü ç ş İ) look right after decoding. Always write output as `utf-8` (add `-sig` only if the user will open it in Excel).
3. **Separator.** Use `csv.Sniffer().sniff(sample, delimiters=',;\t|')`. Semicolon usually means a European/Azerbaijani Excel export with decimal commas.
4. **Header.** Strip spaces and BOM remnants, lower-case, replace spaces with `_`; make names unique (`price`, `price_2`). Keep a mapping old -> new in the log.
5. **Cells.** Strip whitespace; treat `""`, `NA`, `N/A`, `null`, `-` as missing (empty string in output). Never replace missing with 0.
6. **Numbers.** `1 234,50` / `1.234,50` (decimal comma) vs `1,234.50` (thousands comma): decide per column from the majority, then convert. Leave unparseable values as-is and count them.
7. **Dates.** Output ISO `YYYY-MM-DD`. Try formats explicitly (`%d.%m.%Y`, `%d/%m/%Y`, `%Y-%m-%d`, `%m/%d/%Y`); if both day-first and month-first parse for a column, stop and report the ambiguity instead of guessing.
8. **Duplicates.** Remove exact duplicate rows; for duplicates by key (e.g. `id`) keep the first and list the dropped row numbers.
9. **Validate.** Every output row has the same column count; row counts in = out + dropped.

## Python skeleton
```python
import csv, io
raw = open('data/raw.csv', 'rb').read()
for enc in ('utf-8-sig', 'cp1254', 'cp1251', 'latin-1'):
    try: text = raw.decode(enc); break
    except UnicodeDecodeError: pass
dialect = csv.Sniffer().sniff(text[:4096], delimiters=',;\t|')
rows = list(csv.reader(io.StringIO(text), dialect))
header, body = rows[0], rows[1:]
seen, out, dropped = set(), [], 0
for r in body:
    r = [c.strip() for c in r]
    key = tuple(r)
    if key in seen: dropped += 1; continue
    seen.add(key); out.append(r)
with open('data/clean.csv', 'w', encoding='utf-8', newline='') as f:
    csv.writer(f).writerows([header] + out)
print(enc, dialect.delimiter, len(body), len(out), dropped)
```
Always pass `newline=''` when writing on Windows, or you get blank lines between rows.

In Node, read with `fs.readFileSync(p, 'utf8').replace(/^﻿/, '')`; for quoted fields write a small state-machine parser (handle `""` escapes and newlines inside quotes) rather than `split(',')`.

## Cleaning log format (`data/cleaning-log.md`)
```markdown
# Cleaning log - raw.csv
- Encoding: utf-8-sig (BOM removed); separator `;`
- Rows in: 1 204, rows out: 1 187, exact duplicates dropped: 17
- Columns renamed: `Məbləğ (AZN)` -> `mebleg_azn`
- `mebleg_azn`: decimal comma converted, 3 unparseable values kept (rows 88, 412, 950)
- `tarix`: dd.mm.yyyy -> ISO, 0 failures
- Missing values: `email` 42, `phone` 7 (left empty)
- Open questions: none
```
