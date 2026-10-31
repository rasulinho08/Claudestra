---
name: svg-graphics
description: Use when you need an icon, logo, simple illustration or small chart and can hand-write it as inline SVG instead of using an image file or a charting library.
---
# Hand-written SVG graphics

## Rules
1. Always set `viewBox`; let CSS size it (`width: 2rem` or `100%`). Use a simple grid: icons `0 0 24 24`, logos and charts any round numbers.
2. Inline the `<svg>` in HTML when it should follow the theme; use `fill="currentColor"` / `stroke="currentColor"` so it takes the text colour (works in dark mode).
3. Keep it small: basic shapes (`rect`, `circle`, `line`, `polyline`, `path`) with integer or one-decimal coordinates; no embedded bitmaps, no fonts you cannot rely on.
4. Accessibility: decorative -> `aria-hidden="true"`; meaningful -> `role="img"` plus `<title>` (and `<desc>` for charts). Write titles in the page language (Azerbaijani for an `az` page).
5. Never copy or imitate real brand logos or trademarked marks; make original shapes.
6. Validate: the file must parse as XML. Quick check: `node -e "const s=require('fs').readFileSync('logo.svg','utf8');console.log(/^<svg[\s\S]*<\/svg>\s*$/.test(s.trim())?'ok':'check')"`, then open it in a browser.

## Icon (24 x 24, stroke style)
```html
<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>
</svg>
```
Keep one stroke width across a set; leave about 2 units of padding inside the viewBox.

## Logo
- Mark + wordmark side by side; also deliver the mark alone (square viewBox) for favicons.
- Convert text to shapes only if you can draw them; otherwise use `<text>` with `font-family="system-ui, sans-serif"` and say so.
- Max 2-3 colours, defined once as CSS variables or a `<style>` block inside the SVG.

## Simple bar chart (compute coordinates from the data, never invent numbers)
```html
<svg viewBox="0 0 300 160" role="img" aria-labelledby="t d">
  <title id="t">Sales by month</title><desc id="d">Jan 40, Feb 70, Mar 55</desc>
  <g fill="currentColor">
    <rect x="30"  y="100" width="60" height="40"/>   <!-- height = value * scale, y = 140 - height -->
    <rect x="120" y="70"  width="60" height="70"/>
    <rect x="210" y="85"  width="60" height="55"/>
  </g>
  <line x1="20" y1="140" x2="290" y2="140" stroke="currentColor"/>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <text x="60" y="155">Jan</text><text x="150" y="155">Feb</text><text x="240" y="155">Mar</text>
  </g>
</svg>
```
- For more than a few values, generate the SVG with a short Node or Python script from the CSV/JSON data, so numbers match the source.
- Line chart: one `<polyline points="x,y x,y ...">` with `fill="none"`. Pie charts are hard to read; prefer bars.
- Label values or axes directly; start bar axes at zero; include units.

## Output
Save each graphic as `assets/<name>.svg` (or inline it where used) and list the files, their viewBox and where the data came from.
