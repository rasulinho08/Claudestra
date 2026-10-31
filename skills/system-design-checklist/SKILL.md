---
name: system-design-checklist
description: Use when designing a small system or feature before coding: data model, interfaces, storage choice, errors, security, performance and a file-level plan in DESIGN.md.
---
# System design checklist

Write `DESIGN.md` in the workspace before the coder starts. Aim for the simplest design that meets the
requirements; every extra part needs a reason.

## Steps
1. **Requirements:** list the must-have behaviours (from stories or the task) and non-functional limits you were
   given: users, data size, offline or online, platforms (Windows/Linux/macOS), languages (e.g. Azerbaijani UI).
   Unknown limits go under **Assumptions** with a stated value ("assume < 1000 records").
2. **Data model:** entities, fields with types, required/optional, IDs, relations. Give one sample record.
   Store dates as ISO 8601 (`2026-10-31T10:00:00Z`) and money as integer qəpik/cents, not floats.
3. **Interfaces:** every boundary in one list: HTTP routes (method, path, request, response, errors), CLI
   commands and flags, module functions (signature, what it returns or throws), file formats.
4. **Storage:** pick the lightest option that works, and say why:
   - in-memory → JSON/CSV file (atomic write: temp file then rename) → `node:sqlite` / Python `sqlite3`
     when you need queries, many records or concurrent writes (`node:sqlite` is experimental in Node 22;
     check `node -e "require('node:sqlite')"` first, else use Python `sqlite3`). Browser-only: localStorage / IndexedDB.
   - No external database servers or installs.
5. **Errors:** for each interface, what can fail (bad input, missing file, network down, disk full,
   corrupt data) and what the user sees. Validate at the boundary; never crash on bad input.
6. **Security:** untrusted inputs, output encoding (no raw `innerHTML` with user text), path checks for file
   access (stay inside the workspace), parameterised SQL, no secrets in code or logs, least privilege.
7. **Performance:** expected sizes and the slow spots (loops over all records, repeated file reads).
   Only optimise what the stated limits require; note "not measured" rather than guessing numbers.
8. **File-level plan:** every file to create or change, its single responsibility, and which task owns it.
9. **Open questions and decisions:** anything hard to reverse becomes an ADR (see architecture-decision-records).

## Review checklist
- [ ] Every requirement maps to a part of the design.
- [ ] Each interface lists its errors.
- [ ] Data model has one sample record that matches the field list.
- [ ] Nothing needs `npm install` / `pip install`; standard library only.
- [ ] Unicode (ə, ğ, ı, İ, ş) survives storage, sorting (`localeCompare(x, 'az')`) and search.
- [ ] A tester could write cases from this document alone.

## Output format
```markdown
# Design: <system>
## Requirements   ## Assumptions
## Data model
| Entity | Field | Type | Req | Notes |
|--------|-------|------|-----|-------|
| Item | id | string (uuid) | yes | crypto.randomUUID() |
Sample: `{"id":"…","name":"süd","qty":2,"createdAt":"2026-10-31T10:00:00Z"}`
## Interfaces
- `POST /api/items` {name, qty} → 201 Item | 400 {error} 
## Storage   ## Errors   ## Security   ## Performance
## Files
| Path | Responsibility | Owner task |
|------|----------------|-----------|
| server.js | HTTP routes, validation | T3 |
| store.js | read/write data/items.json | T3 |
## Open questions
```
