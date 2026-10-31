---
name: localization-i18n
description: Use when preparing an app for several languages: JSON string files, placeholders, plural forms, date/number formats, RTL and translating UI strings in place.
---
# Localization (i18n)

## 1. Extract strings
1. Find every user-visible string (labels, buttons, errors, titles, alt text, emails). Do not translate log
   messages, keys, CSS classes or API field names.
2. Move them to one JSON file per language: `locales/en.json`, `locales/az.json`, `locales/ru.json`.
   Flat, stable, meaning-based keys: `"cart.empty"`, `"login.button"` (not `"text1"` or the English text).
3. Never build sentences by concatenation (`"Hello " + name`): word order differs between languages.
   Use placeholders: `"greeting": "Hello, {name}!"` / `"greeting": "Salam, {name}!"`.

## 2. Tiny loader (no library)
```js
import fs from 'node:fs';
const load = l => JSON.parse(fs.readFileSync(`locales/${l}.json`, 'utf8'));
const dict = { en: load('en'), az: load('az') };
export function t(lang, key, vars = {}) {
  let s = dict[lang]?.[key] ?? dict.en[key] ?? key;            // fallback to English, then key
  if (typeof s === 'object') s = s[new Intl.PluralRules(lang).select(vars.n)] ?? s.other; // plurals
  return s.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? `{${v}}`);
}
```
In the browser load with `await (await fetch('locales/az.json')).json()` instead of `fs`.

## 3. Plurals
Use `Intl.PluralRules`, store one string per category:
```text
"files.count": { "one": "{n} file", "other": "{n} files" }      // en
"files.count": { "one": "{n} fayl", "other": "{n} fayl" }       // az: noun stays singular after numbers
"files.count": { "one": "{n} файл", "few": "{n} файла", "many": "{n} файлов", "other": "{n} файла" } // ru
```
Call `t(lang, 'files.count', { n: 5 })`; `t` picks the category. Check categories:
`node -e "console.log(new Intl.PluralRules('ru').resolvedOptions().pluralCategories)"`.

## 4. Dates, numbers, currency
Never hard-code formats; pass the locale:
- `new Intl.DateTimeFormat('az', { dateStyle: 'long' }).format(d)`
- `new Intl.NumberFormat('az').format(1234.5)` -> `1.234,5`
- `new Intl.NumberFormat('az', { style: 'currency', currency: 'AZN' }).format(25)`
Store dates as ISO 8601 UTC, convert only for display. Sort text with `localeCompare(b, lang)`.

## 5. Layout and RTL
- Translations can be 30-50% longer than English: no fixed-width buttons, allow wrapping.
- Set `<html lang="az">`; for Arabic, Persian, Hebrew also `dir="rtl"`. Use logical CSS
  (`margin-inline-start`, `padding-inline-end`, `text-align: start`) so RTL works without a second stylesheet.
- Language switcher shows names in their own language: "English", "Azərbaycanca", "Русский". No flags for languages.

## 6. Translating strings in place
1. Copy the source file, keep keys and placeholders exactly (`{name}` stays `{name}`, HTML tags stay).
2. Translate meaning, not words; keep UI labels short; use the target's formal address (AZ: siz).
   For Azerbaijani follow the `azerbaijani-writing` skill.
3. Unsure strings get `"__todo": true` in a separate `locales/_review.json`, never a guess.

## 7. Check
Run a key/placeholder check (save as `check-i18n.mjs`, run `node check-i18n.mjs`):
```js
import fs from 'node:fs';
const L = Object.fromEntries(fs.readdirSync('locales').filter(f => /^[a-z-]+\.json$/i.test(f))
  .map(f => [f, JSON.parse(fs.readFileSync('locales/' + f, 'utf8'))]));
const base = L['en.json'], ph = s => JSON.stringify(s).match(/\{\w+\}/g)?.sort().join() ?? '';
for (const [f, d] of Object.entries(L)) for (const k of Object.keys(base)) {
  if (!(k in d)) console.log(`${f}: missing ${k}`);
  else if (ph(d[k]) !== ph(base[k]) && typeof base[k] === 'string') console.log(`${f}: placeholders differ in ${k}`);
}
```
Report: languages covered, missing keys, strings needing native review.
