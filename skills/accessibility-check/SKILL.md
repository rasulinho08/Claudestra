---
name: accessibility-check
description: Use when building or reviewing a web page or UI to check it against WCAG 2.2 AA (contrast, labels, keyboard, focus, alt text, ARIA) and report findings.
---
# Accessibility check (WCAG 2.2 AA)

Work on the HTML/CSS/JS files in the workspace. Check by reading the code and, if you can, by running a small script.
Report only what you actually found; say "not checked" for anything you could not verify.

## Checklist
1. **Language and title**: `<html lang="en">` (or `lang="az"` for Azerbaijani pages, one `lang` per language block);
   every page has a unique, descriptive `<title>`.
2. **Structure**: one `<h1>`, headings in order (no h2 -> h4 jumps); landmarks `<header> <nav> <main> <footer>`;
   lists are `<ul>/<ol>`, tables have `<th scope>` and a `<caption>` when the purpose is not obvious.
3. **Text contrast** (1.4.3): normal text >= 4.5:1, large text (>= 24px, or >= 18.66px bold) >= 3:1.
   **Non-text contrast** (1.4.11): icons, input borders, focus rings >= 3:1 against their background.
4. **Images** (1.1.1): informative `<img>` has `alt` that says what it conveys; decorative images use `alt=""`;
   icon-only buttons get an accessible name (`aria-label` or visually hidden text).
5. **Forms** (1.3.1, 3.3.2): every input has a `<label for>`; required fields are marked in text, not only by color;
   errors name the field and how to fix it, and are linked with `aria-describedby`; use `autocomplete` on personal data.
6. **Keyboard** (2.1.1): everything clickable is a `<button>` or `<a href>`, not a `<div onclick>`; Tab order follows
   the visual order; no keyboard traps; modals close with Esc and return focus to the opener.
7. **Focus** (2.4.7, 2.4.11): focus is always visible (never `outline: none` without a replacement) and not hidden
   behind sticky headers. Add a "Skip to main content" link as the first focusable element.
8. **Target size** (2.5.8): pointer targets are at least 24x24 CSS px or have enough spacing.
9. **Color alone** (1.4.1): links in body text are underlined or otherwise distinct; states are not color-only.
10. **Resize and reflow** (1.4.4, 1.4.10): page works at 200% zoom and 320px width without horizontal scroll.
11. **Motion**: respect `prefers-reduced-motion`; nothing flashes more than 3 times per second; carousels can pause.
12. **ARIA only when needed**: prefer native elements. If you add ARIA, the role/state must be correct and updated by JS
    (`aria-expanded`, `aria-current="page"`). Never put `aria-hidden="true"` on focusable content.
13. **Dynamic updates**: status messages use `role="status"` or `aria-live="polite"`.
14. **Redundant entry and auth** (3.3.7, 3.3.8): do not make users retype data or solve puzzles to log in.

## Contrast without extra tools
```js
// node contrast.js "#767676" "#ffffff"
const [a, b] = process.argv.slice(2).map(h => h.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255)
  .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
console.log(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) + ':1');
```
Quick scans: search the files for `<img` without `alt`, `outline: none`, `onclick` on `div`/`span`, inputs without labels.

## Report format
Write `accessibility-report.md`:

| # | Severity | WCAG | Where (file:line or selector) | Problem | Fix |
|---|----------|------|-------------------------------|---------|-----|
| 1 | High | 1.4.3 | styles.css:42 `.muted` | #999 on #fff is 2.85:1 | Use #767676 (4.54:1) |

Severity: **High** blocks a task (cannot submit form by keyboard), **Medium** makes it hard, **Low** is polish.
End with: what you fixed, what remains, and what needs a manual test (screen reader, real zoom). An automated pass is not
proof of conformance; do not claim "fully WCAG compliant".
