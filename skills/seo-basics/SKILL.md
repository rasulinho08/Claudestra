---
name: seo-basics
description: Use when building or reviewing a small website to set titles, meta descriptions, headings, semantic HTML, Open Graph tags, sitemap.xml and robots.txt.
---
# SEO basics for small sites

Goal: every page is understandable to search engines and looks right when shared. Do not promise rankings or traffic.
If the real domain is unknown, use `https://example.com` and list it under **Open questions**.

## Per page
1. `<html lang="...">` matches the content (`az` for Azerbaijani, `en`, `ru`); one language per URL.
2. `<title>`: unique, 50-60 characters, main topic first, brand last: `Handmade Carpets in Baku | Xalca`.
3. `<meta name="description">`: unique, 120-160 characters, says what the page offers and invites the click.
   Write it for people; no keyword stuffing.
4. One `<h1>` that matches the page intent; `h2`/`h3` in order to outline the content.
5. Semantic HTML: `<header> <nav> <main> <article> <section> <footer>`; real `<a href>` links with descriptive text
   (not "click here"); images with `alt`, `width`/`height` and `loading="lazy"` below the fold.
6. Clean URLs: lowercase, hyphens, no spaces: `/services/web-design/`. For Azerbaijani words, transliterate
   letters (ə->e, ş->sh, ç->ch, ğ->g, ı->i, ö->o, ü->u) or keep UTF-8 consistently; pick one rule and use it everywhere.
7. `<link rel="canonical" href="https://example.com/page/">` on every page; for translations add
   `<link rel="alternate" hreflang="az" href="...">` for each language version, including itself.
8. `<meta name="viewport" content="width=device-width, initial-scale=1">`; keep pages light (compress images,
   no unused scripts).

## Open Graph and sharing
```html
<meta property="og:title" content="Handmade Carpets in Baku">
<meta property="og:description" content="Same idea as the meta description.">
<meta property="og:image" content="https://example.com/og/home.jpg"> <!-- 1200x630, absolute URL -->
<meta property="og:url" content="https://example.com/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```
Structured data (`application/ld+json`, schema.org `Organization`, `LocalBusiness`, `Article`) only with facts the
client gave you: never invent addresses, ratings or opening hours.

## Site files
- `robots.txt` at the root:
  ```
  User-agent: *
  Allow: /
  Sitemap: https://example.com/sitemap.xml
  ```
  Use `Disallow:` only for private/duplicate areas; a staging site gets `Disallow: /`.
- `sitemap.xml` listing canonical URLs only. Generate it from the HTML files without installs:
  `node -e "const fs=require('fs'),p=require('path');const b='https://example.com';const w=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?w(p.join(d,e.name)):e.name.endsWith('.html')?[p.join(d,e.name)]:[]);const u=w('site').map(f=>'<url><loc>'+b+'/'+p.relative('site',f).split(p.sep).join('/').replace(/index\.html$/,'')+'</loc></url>');fs.writeFileSync('site/sitemap.xml','<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n'+u.join('\n')+'\n</urlset>\n')"`
  (replace `site` with the folder that holds the pages).
- A helpful `404.html` with links back to main sections.

## Output
Write `seo-report.md` with a table: `Page | Title (chars) | Description (chars) | H1 | Canonical | OG image | Issues`.
Then list fixes made, remaining issues, and Open questions (domain, target city/language, brand name).
