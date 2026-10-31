---
name: responsive-css
description: Use when styling a page that must work from phone to desktop: mobile-first CSS with grid/flex, custom properties, fluid type and dark mode, no frameworks.
---
# Responsive CSS (mobile-first, plain CSS)

## Steps
1. Write base styles for a 360 px phone first; add `@media (min-width: ...)` only where the layout must change.
2. Put every colour, space, radius and font size in custom properties on `:root`.
3. Use flex for one direction (toolbars, rows), grid for two (cards, page layout).
4. Make type and spacing fluid with `clamp()`; avoid fixed widths and heights.
5. Add dark mode by redefining the tokens, not by rewriting components.
6. Check at 360, 768 and 1280 px and with 200% browser zoom.

## Starter
```css
*, *::before, *::after { box-sizing: border-box; }
:root {
  --bg: #ffffff; --text: #1a1a1a; --muted: #5c5c5c; --accent: #0b63ce; --surface: #f3f4f6;
  --space: clamp(0.75rem, 2vw, 1.25rem);
  --radius: 0.5rem;
  --fs-body: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --fs-h1: clamp(1.75rem, 1.2rem + 2.5vw, 3rem);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #121212; --text: #ececec; --muted: #a6a6a6; --accent: #6aa8ff; --surface: #1e1e1e; }
}
body { margin: 0; background: var(--bg); color: var(--text); font: var(--fs-body)/1.5 system-ui, sans-serif; }
h1 { font-size: var(--fs-h1); line-height: 1.15; }
img, svg, video { max-width: 100%; height: auto; }
.container { width: min(100% - 2rem, 70rem); margin-inline: auto; }
.cards { display: grid; gap: var(--space); grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr)); }
.row { display: flex; flex-wrap: wrap; gap: var(--space); align-items: center; }
@media (min-width: 48rem) { .layout { display: grid; grid-template-columns: 15rem 1fr; gap: var(--space); } }
```
`auto-fit` + `minmax` gives 1 column on phones and more on wide screens without any media query.

## Checklist
- [ ] No horizontal scroll at 360 px (long words/URLs: `overflow-wrap: anywhere`).
- [ ] Tap targets at least 44 x 44 px; inputs at least 16 px font (stops iOS zoom).
- [ ] Text contrast at least 4.5:1 in both light and dark mode; never colour alone to show state.
- [ ] Visible focus: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.
- [ ] Respect motion settings: wrap animations in `@media (prefers-reduced-motion: no-preference)`.
- [ ] Use `rem`/`em` for breakpoints and sizes so zoom works; `px` only for hairlines.
- [ ] Use logical properties (`margin-inline`, `padding-block`) so RTL or long translations do not break.
- [ ] Leave room for longer strings: Azerbaijani labels are often 20-30% longer than English; no fixed-width buttons.
- [ ] Optional manual toggle: set `data-theme="dark"` on `<html>` and mirror the dark tokens under `[data-theme="dark"]`.

## Output
Deliver one `style.css` (or a `<style>` block) ordered: tokens, base, layout, components, utilities, media queries.
State the breakpoints you used and which widths you checked; if you could not view it in a browser, say so.
