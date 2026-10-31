---
name: charts-without-libraries
description: Use when you need a bar, line or pie chart in a page or report and should build it as inline SVG or HTML/CSS from real data, without Chart.js or any library.
---
# Charts without libraries

## Rules
1. Compute every coordinate from the data with a script (Node or Python) or in page JS. Never hand-type numbers that are not in the data, and never invent data to fill a chart.
2. Pick the form by the question: compare categories -> horizontal bar; change over time -> line; parts of a whole with at most 5 slices -> pie/donut, otherwise bar.
3. Bars start at zero. Label axes and units (`AZN`, `%`, `nəfər`). Sort bars by value unless the categories have a natural order.
4. Colours: one accent for one series; max 5 distinct colours; never colour as the only carrier of meaning, so add direct labels.
5. Accessibility: `role="img"`, `<title>` and `<desc>` (summary of the main finding), plus a visually-hidden or `<details>` data table with the same numbers. Use the page language (Azerbaijani for `lang="az"`, with decimal comma if the page uses it).
6. Use `fill="currentColor"` / CSS variables so the chart works in dark mode; set `viewBox` and let CSS size it (`width:100%`).

## Bar chart: generate SVG with Node
```js
// node make-bar.js > chart.svg
const data = [['Bakı', 120], ['Gəncə', 45], ['Sumqayıt', 38]];
const W = 400, rowH = 28, left = 90, max = Math.max(...data.map(d => d[1]));
const bars = data.map(([label, v], i) => {
  const y = i * rowH, w = Math.round((v / max) * (W - left - 40));
  return `<text x="${left - 6}" y="${y + 18}" text-anchor="end">${label}</text>
  <rect x="${left}" y="${y + 6}" width="${w}" height="16" fill="var(--accent, #3b6ea5)"/>
  <text x="${left + w + 4}" y="${y + 18}">${v}</text>`;
}).join('\n');
console.log(`<svg viewBox="0 0 ${W} ${data.length * rowH}" role="img" font-size="12" fill="currentColor"
 aria-labelledby="t d"><title id="t">Sifarişlər şəhər üzrə</title>
<desc id="d">Bakı 120, Gəncə 45, Sumqayıt 38 sifariş.</desc>${bars}</svg>`);
```
Escape `<`, `&` and `"` in labels before inserting them.

## Line chart
- Scale: `x = left + i * (plotW / (n - 1))`, `y = top + plotH - (v - min) / (max - min) * plotH` (use `min = 0` unless the range is narrow and you say so).
- Draw one `<polyline points="x1,y1 x2,y2 ..." fill="none" stroke="currentColor" stroke-width="2"/>`, a `<circle r="3">` per point, 3-5 horizontal gridlines with value labels, and first/last x labels.
- Handle missing values by splitting into separate polylines, not by drawing through zero.

## Pie / donut with CSS only
```html
<div class="pie" style="--a:55; --b:30" role="img" aria-label="Mobil 55%, Desktop 30%, Planşet 15%"></div>
<style>.pie{width:160px;aspect-ratio:1;border-radius:50%;
background:conic-gradient(#3b6ea5 0 calc(var(--a)*1%),#e0a03a 0 calc((var(--a) + var(--b))*1%),#8a8f98 0);}</style>
```
Percentages must sum to 100 (check in the script); add a legend list next to it with the same labels and values. For SVG pies, use arcs: `M cx cy L x0 y0 A r r 0 large 1 x1 y1 Z` with `large = angle > 180 ? 1 : 0`.

## HTML/CSS bar alternative
`<div class="bar" style="width:62%">Bakı 62%</div>` inside a list works for simple dashboards and is readable by screen readers as text.

## Check before delivering
- [ ] Numbers in labels match the source data exactly; source and date noted under the chart.
- [ ] Opens in a browser; readable at 320 px width and in dark mode.
- [ ] Title, desc/aria-label and data table present.
