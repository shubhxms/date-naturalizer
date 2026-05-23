# Date Naturalizer

A Chrome extension that underlines dates on web pages and shows them in your
timezone on hover. Lightweight, MV3, no external network calls.

## What it does

- Scans page text for absolute dates (`May 23, 2026`, `2024-01-15`, `Aug 14, 2025`,
  date+time, etc.) and underlines them with a dotted line.
- Hover any underlined date for a tooltip with:
  - The relative interpretation in plain English (`Today`, `Yesterday`,
    `5 hours ago`, `3 months ago`)
  - The precise date+time in your local timezone, with day-of-week
  - Per-zone comparison rows if you've added extra timezones in the popup
- Optionally resolves relative phrases like `yesterday`, `5 days ago`,
  `next Friday` against the article's publication date (off by default —
  toggle in the popup; results can be inaccurate when the page has no
  detectable publish time).

## Install (unpacked)

```sh
npm install
npm run build         # outputs to dist/
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory

For live rebuilds while iterating: `npm run watch`.

## Popup settings

Click the toolbar icon to open the popup. Settings persist via `chrome.storage.sync`.

- **Enabled on this site** — per-host disable
- **Enabled everywhere** — global kill switch
- **Convert relative dates** — off by default; see caveats above
- **Extra timezones** — add any IANA zone (e.g. `Asia/Tokyo`, `Pacific/Niue`)
  from the searchable input. Each appears as a comparison row in the tooltip.

The popup also shows your detected local time and IANA zone in the header —
the same zone the extension uses for conversion.

## How it works

Roughly:

1. **Block-level scanning.** A `TreeWalker` collects text nodes per nearest
   block ancestor (`<p>`, `<td>`, `<li>`, `<h1..6>`, etc.). All text in a
   block is concatenated into one string with an offset map back to the
   original nodes. Open shadow roots are recursed into and observed
   separately (so YouTube comment timestamps work).
2. **Date parsing.** [chrono-node](https://github.com/wanasit/chrono) parses
   the joined string. Reference date is the article's publication date when
   detectable (JSON-LD `datePublished`, OpenGraph `article:published_time`,
   `<time pubdate>`, etc.) so relative phrases resolve against the right
   "now". Falls back to today otherwise.
3. **Filtering.** Throws out:
   - Bare prose (matches must have ≥ 3 chars and a letter)
   - Filler words (`now`, `today`, `tonight`)
   - Duration phrases — `for/over/within/after/past N <unit>`,
     `in N <month|year|decade|century>`, `N <unit> later/earlier/before/hence`.
     `for 8h+`, `5 years later`, `a few weeks after` all drop out.
   - When `convertRelatives` is off, anything without a month name or ISO
     date in the source text
4. **Merging.** Adjacent time-only + date-only matches separated by a small
   gap of separator punctuation (Twitter's `·`, etc.) are fused into a
   single synthetic result carrying the combined instant.
5. **Year/TZ context.** For matches with implied year, the nearest year in
   the same block (within 80 characters) wins; falls back to ancestor
   `textContent`, then to the year in `<title>`/`<h1>`. For bare datetimes
   in an infobox `<td>` whose sibling `<th>` says "UTC time", the instant
   gets reinterpreted as UTC instead of host-local.
6. **Anchoring relatives.** Within a block, relative phrases (`yesterday`,
   `5 days ago`) resolve against the nearest absolute date in the same
   block before falling back to the page reference — so a tweet's
   `yesterday` resolves against the tweet's own timestamp.
7. **Wrapping.** Each match's extent (with leading connector words like
   "on" trimmed, trailing time/zone tokens kept) is wrapped in a
   `.dn-date` span. The span carries `data-iso`, `data-gran` (`time` /
   `day` / `month`) and `data-rel` if the source was a relative phrase.
   A match can wrap across multiple text nodes — all share the same
   tooltip payload.
8. **Tooltip.** A single floating div, position-clamped to the viewport.
   Lead line is the relative interpretation; sub line is the precise
   datetime. When the source was itself a relative phrase, the two swap
   (lead becomes the resolved date) since the user already had the
   relative on the page.

## Project layout

```
manifest.json              # MV3 manifest
build.mjs                  # esbuild bundle + static copy + on-the-fly icon PNGs
src/
├── content.js             # scanner + tooltip
├── content.css            # underline + tooltip styles
├── popup.html
├── popup.css
├── popup.js
└── lib/
    └── format.js          # formatInTz + relative (gran-aware)
```

The build script generates 16/48/128 px PNG icons procedurally so there are
no binary blobs in the repo.

## Known limitations

- **Cross-row infobox merges** are ignored. Wikipedia's `Local date` / `Local
  time` rows in an infobox stay separate because they're in different
  `<tr>`s — joining them would be unsafe in general.
- **Closed shadow roots** can't be reached (rare in practice).
- **Heavy SPA pages** that re-render time strings every minute will
  re-scan on each `MutationObserver` characterData event, which is fine
  but does some redundant work.
- **Locale formatting** is browser-default — the tooltip uses
  `Intl.DateTimeFormat(undefined, ...)`, which respects the user's
  browser locale.

## Stack

- Manifest V3, vanilla JS in the content script
- [chrono-node](https://github.com/wanasit/chrono) for date parsing
- [esbuild](https://esbuild.github.io/) for bundling

No framework, no router, no font/CSS loads from the network.
