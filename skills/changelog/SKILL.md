---
name: changelog
description: Use when writing CHANGELOG.md entries in Keep a Changelog style or user-facing release notes for a new version.
---
# Changelog and release notes

The changelog is for people using the project, not a copy of the git log.

## 1. Find what changed
1. If git exists: `git log --oneline <last-tag>..HEAD` (find tags with `git tag --sort=-creatordate`).
   No tags: use the commits since the last version mentioned in CHANGELOG.md or package.json.
2. No git: compare against the task description and the files you changed in this run.
3. Read the diff of anything unclear; never describe a change you have not seen.

## 2. CHANGELOG.md format
```markdown
# Changelog
All notable changes to this project are documented in this file.
The format is based on Keep a Changelog, and this project uses Semantic Versioning.

## [Unreleased]

## [1.2.0] - 2026-10-31
### Added
- Export the shopping list as CSV (`Export` button).
### Changed
- Prices now accept a comma as decimal separator ("1,50").
### Fixed
- Empty list no longer shows "undefined items".
### Removed
- The old `/api/v0` endpoints.
### Security
- Item names are escaped before rendering (prevents HTML injection).
```
Allowed sections, in this order: Added, Changed, Deprecated, Removed, Fixed, Security. Omit empty ones.

## 3. Rules for entries
- Newest version on top; dates as `YYYY-MM-DD`; keep `[Unreleased]` for work not yet released.
- One line per change, written from the user's point of view: what they can now do or no longer see.
  Bad: "Refactor utils.js". Good: "Search is faster on lists over 1000 items" (only if measured).
- Merge several commits about one feature into one line; skip pure internal changes (tests, formatting)
  unless the audience is developers.
- Breaking changes: prefix with **BREAKING:** and say what the user must do.
- Version bump (SemVer): breaking -> major, new feature -> minor, only fixes -> patch. Use the version the
  task gives; if none, propose one and say it is a proposal. Update `package.json` only if asked.
- Edit the existing file; never rewrite or reorder old released entries.

## 4. Release notes (for announcements, app stores, emails)
```markdown
# Version 1.2.0 (31 October 2026)
Highlights
- You can now export your list as CSV.
Fixes
- Prices like "1,50" are read correctly.
Action needed
- None.
```
- 3 to 7 bullets, plain language, no commit hashes or internal names.
- Never invent numbers ("2x faster") or user quotes; use only what was measured or stated in the task.
- If the users are Azerbaijani, write the notes in Azerbaijani (e.g. "Yeniliklər", "Düzəlişlər",
  "Tələb olunan addım") with correct ə, ğ, ı, ö, ü, ç, ş; the CHANGELOG.md itself can stay in English.

## 5. Report
The version and date used, the file(s) changed, and any change you left out on purpose and why.
