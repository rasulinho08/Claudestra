---
name: web-app-basics
description: Use when building a small HTML/CSS/JS app that must open by double-clicking index.html, with no build step, no server and data saved in localStorage.
---
# Web app basics (no build, opens from file://)

## Layout
- `index.html`: markup, links `style.css` and `app.js`. One file is fine for very small apps (inline `<style>` and `<script>`).
- `style.css`, `app.js`, optional `data.js` (sample data as `const SAMPLE = [...]`). Use relative paths only.
- `README.md`: "Open index.html in a browser (Chrome, Edge, Firefox). Data is stored in this browser only."

## file:// rules (the app must work by double-click)
1. Use classic scripts: `<script src="app.js" defer></script>`. No `type="module"`, no `import`/`export`:
   browsers block ES modules on file:// (CORS error, blank page).
2. Several scripts share globals; load them in order (`data.js` before `app.js`), each with `defer`.
3. No `fetch()` of local files (blocked on file://). Put data in a JS file or let the user pick a file with
   `<input type="file">` + `FileReader`.
4. No CDN links, frameworks or npm packages; plain DOM APIs only. The app must work offline.

## Skeleton
```html
<!doctype html>
<html lang="en"><!-- use lang="az" for an Azerbaijani UI -->
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Task list</title><link rel="stylesheet" href="style.css">
  <script src="app.js" defer></script>
</head>
<body><main id="app"></main></body>
</html>
```

## Data in localStorage
```js
const KEY = 'tasklist.v1';                       // app-specific, versioned key
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}
function save(items) { localStorage.setItem(KEY, JSON.stringify(items)); }
```
- Keep one state object; every change = update state, `save()`, `render()`.
- Offer Export (download JSON via `Blob` + `URL.createObjectURL`) and Import (file input) so data is not lost.
- Never store passwords or secrets; say in the README that clearing browser data deletes everything.

## Code rules
- Build DOM with `document.createElement` and `textContent`; never put user input into `innerHTML` (XSS).
- Use real `<button>`, `<label for>`, `<form>` with `submit` listener and `event.preventDefault()`.
- Format dates and numbers with `Intl` (`new Intl.DateTimeFormat('az-AZ')` for Azerbaijani users).
- UTF-8 everywhere so Azerbaijani letters (ə, ğ, ı, ö, ş, ç, ü) show correctly.
- Show an empty state ("No tasks yet") and clear validation messages.

## Check before handing over
1. Syntax: `node --check app.js`.
2. Pure logic (filtering, totals) lives in functions that do not touch the DOM; test them with `node:test`
   by guarding the export: `if (typeof module !== 'undefined') module.exports = { total };`
3. Open via file:// (not a dev server) and confirm: no console errors, data survives a reload, works at 375 px width.
4. Report what you checked and how; do not claim browser testing you could not do.
