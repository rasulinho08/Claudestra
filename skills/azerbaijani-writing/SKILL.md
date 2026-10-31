---
name: azerbaijani-writing
description: Use when writing or editing Azerbaijani text (UI, docs, marketing, emails): correct Latin spelling, formal siz, software terms, number/date/AZN formats, no calques.
---
# Azerbaijani writing

## Alphabet and spelling
1. Use the Latin alphabet only: a b c ç d e ə f g ğ h x ı i j k q l m n o ö p r s ş t u ü v y z.
   Never replace ə with "e"/"a", ı with "i", ş with "sh", ç with "ch", ğ with "g", ö/ü with o/u.
2. Case rules: `i` -> `İ` and `ı` -> `I`. In code use `s.toLocaleUpperCase('az')` / `toLocaleLowerCase('az')`;
   sort with `a.localeCompare(b, 'az')`.
3. Files must be UTF-8. Quick check for missing letters:
   `node -e "const t=require('fs').readFileSync(process.argv[1],'utf8');console.log(/[əğışçöü]/i.test(t)?'ok':'no AZ letters - check!')" file.md`
4. Vowel harmony in suffixes: fayl**lar**, istifadəçi**lər**; qovluq**da**, səhifə**də**. Proper names take an
   apostrophe before suffixes: `Claudestra'da`, `GitHub'a`.

## Tone
- Address users with formal **siz** and the -in/-ın/-un/-ün imperative: "Daxil olun", "Faylı seçin".
  Short button labels may use the bare form: "Yadda saxla", "Sil", "Ləğv et". Pick one style per product and keep it.
- Drop redundant pronouns: "Parolunuz səhvdir" not "Sizin parolunuz səhvdir".
- Prefer active, short sentences; put the verb at the end (SOV word order).

## Common software terms
| EN | AZ |
|---|---|
| Sign in / Sign out / Sign up | Daxil ol / Çıxış / Qeydiyyat |
| Password / User / Account | Parol (şifrə) / İstifadəçi / Hesab |
| Save / Cancel / Delete / Edit | Yadda saxla / Ləğv et / Sil / Redaktə et |
| Settings / Search / Notification | Parametrlər (Ayarlar) / Axtarış / Bildiriş |
| File / Folder / Upload / Download | Fayl / Qovluq / Yüklə / Endir |
| Error / Warning / Loading... | Xəta / Xəbərdarlıq / Yüklənir... |
If the client already has a glossary, follow it; otherwise add a `Glossary` section listing your choices.

## Numbers, dates, money
- Decimal comma, dot or space for thousands: `1.234,56` (check with
  `node -e "console.log(new Intl.NumberFormat('az').format(1234.56))"`).
- Money: `25,50 AZN` or `25,50 ₼` (symbol after the number, with a space). Pick one per document.
- Dates: `31.10.2026`, or `31 oktyabr 2026`; months and weekdays lowercase: yanvar, fevral, mart, aprel, may, iyun,
  iyul, avqust, sentyabr, oktyabr, noyabr, dekabr; bazar ertəsi ... bazar. Time 24h: `14:30`.
- Percent: `15%`. Ordinals: `2-ci`, `3-cü`, `5-ci`, `6-cı` (suffix follows harmony).
- After a number the noun stays singular: "5 fayl", "3 istifadəçi" (not "5 fayllar").

## Avoid calques (from English or Russian)
- "Bu məna edir" (makes sense) -> "Bu məntiqlidir".
- "Mən düşünürəm ki..." in every sentence -> "Məncə...".
- "Öz növbəsində", "bu gün üçün" (на сегодня) -> "isə", "hazırda".
- "Klik edin" is fine in UI, but "Basın"/"Seçin" often reads more natural.
- Do not keep English word order or capitalise Every Word In Titles: only the first word and proper names.

## Before handing over
Checklist: all special letters present; one address form (siz) throughout; terms consistent with glossary; numbers,
dates and currency in AZ format; no machine-translation artefacts; read every sentence aloud once.
If you are unsure of a term, mark it `[AZ TERM?: ...]` instead of guessing.
