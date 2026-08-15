# Jameel Noori Nastaleeq (optional)

Urdu renders in Nastaliq either way — **nothing here is required.**

`app/globals.css` declares an `@font-face` for `Jameel Noori Nastaleeq`
pointing at this folder, with **Noto Nastaliq Urdu** (Google Fonts,
open-licensed) as the fallback. With no file here, the browser simply
skips to that fallback — Urdu still displays in proper Nastaliq script.

## To use Jameel Noori Nastaleeq instead

Drop the font file into this folder with **exactly** one of these names:

- `JameelNooriNastaleeq.woff2` — preferred (roughly 4-5× smaller than
  the `.ttf`, which matters: Nastaliq fonts are large, and this one is
  several MB as a raw TrueType file)
- `JameelNooriNastaleeq.ttf` — works, but slower for visitors to load

No code change is needed. The CSS already prefers this family.

To convert a `.ttf` to `.woff2`, use any web font converter
(e.g. cloudconvert.com, or `woff2_compress` from Google's woff2 tools).

## Licensing

Jameel Noori Nastaleeq is **not** an open-source font. It is free for
personal use; confirm your own licensing position before shipping it in
a commercial product. This is why the file is not committed to the repo
and why an open-licensed fallback is configured.
