# mx-lab

One clean, validated dataset of AMA Pro Motocross results, and six analyses published on top of it.

**Unofficial.** This project is not affiliated with or endorsed by AMA Pro Racing, MX Sports, Pro
Motocross, or any series, team or rider. Series names appear in plain text only; no logos or marks
are used. Results are attributed to their timing and scoring providers.

> **Status: 2020–2026 is ingested — 77 events, 12,241 result rows, 174,876 per-lap times.**
> 2020–2024 comes from the PDF archive (55 events) and 2025–2026 from the LiveTime results site
> (22 events, ADR 0005); no event is refused by the gate. Per-lap **positions** exist only for
> 2025–2026. **The six analyses and the static site are built** — `data/derived/`, `site/` and
> `docs/analyses.md` record what each one measures and where its coverage stops.

## Sources (verified 2026-11-04)

| Seasons | Source | Format | What it provides |
|---|---|---|---|
| 2020–2024 | `americanmotocrossresults.com` (LiveTime PDF archive) | PDF, one file per session | Results, per-lap times, qualifying over the whole entry list |
| 2025–2026 | `results.promotocross.com` (LiveTime Scoring Engine) | Server-rendered HTML | Results, per-lap times **and per-lap positions**, qualifying |

- The two PDF hosts in the archive (`americanmotocrossresults.com` and
  `live.amaproracing.com`) are the **same backend** — byte-identical files. One origin is used.
- There is an XML manifest beside the PDFs (`<EventID>SchedRes.xml`), but it holds **links and
  schedule only, no result values** — see `docs/adr/0001-result-source.md`.
- The PDF archive **ends at 2024**, which is why a second source exists for 2025–2026.

## Findings that changed the plan

All four are recorded with evidence in `docs/sources.md` §14 and the ADRs:

1. **The lap chart is not a source of positions.** Its grid holds plate numbers, not positions
   (`…#4 - C. Sexton  2 7 7 7 7 7 7 96 96 [233] [60]…`), with boxed cells marking lapped riders.
   Per-lap positions for 2020–2024 are therefore **not available**; per-lap *times* are.
2. **The clean per-lap sheet is `RID` (Individual Lap Times)**, not the segment-times sheet, which
   interleaves two riders per page and hides values behind geometry.
3. **The final lap is often absent on the sheets.** For 18 of 40 riders at Pala, `MIN` is printed in
   the final lap's slot, so the dataset holds 14 lap times for a 15-lap moto. Recorded as a
   warning, never invented.
4. **Qualifying is the whole entry list, not the moto field** — 71 entrants against 40 starters,
   printed in two parts split by `TOP 36 RIDERS QUALIFY`.

## Coverage

| Season | Events | Result rows | Per-lap times | Source |
|---|---|---|---|---|
| 2020 | 9 | 1,400 | 20,028 | PDF archive |
| 2021 | 12 | 1,920 | 27,078 | PDF archive |
| 2022 | 12 | 1,880 | 26,623 | PDF archive |
| 2023 | 11 | 1,760 | 24,669 | PDF archive |
| 2024 | 11 | 1,760 | 24,840 | PDF archive |
| 2025 | 11 | 1,762 | 25,405 | LiveTime |
| 2026 | 11 | 1,759 | 26,233 | LiveTime |

Every round parses: `npm run survey` checks 2020–2024 against the archive's own `M<YY><NN>`
numbering, and `node scripts/lt-season.js` rebuilds a 2025/2026 season plus its roster.

A plate number is unique **per class within a season**, so `data/rosters/<year>.json` maps
`class:plate` to a rider — that is what identifies a rider across events, and what makes a real
number conflict visible. Rosters exist for all seven seasons. The PDF-era sheets print a long name
into the hometown column (`Lane Shaw         Alv`); the parser now measures that column from each
sheet, and the roster still folds any such spelling as an `alias`, so one rider cannot appear as two.
A genuinely different rider on the same plate is reported as a warning instead of being merged.

## Layout

```
src/
  build.js              event assembly (pure) + networked build CLI
  build-lt.js           2025–2026 adapter: LiveTime pages into the same dataset
  validate.js           the gate: contradictions fail, source gaps warn
  identity.js           rider slugs and overrides
  lib/                  text/time, HTML tables, deterministic JSON, HTTP cache, poppler wrapper
  parse/                results, lap-times, qualifying and LiveTime report parsers
  sources/              ama.js (manifest discovery), promotocross.js (event index and hubs)
  derive/               the six analyses: pure functions over the committed dataset
site/                   static site: plain HTML, CSS and ES modules, no dependencies
tests/
  harness.js, run.js    dependency-free test harness
  *.test.js             70 tests over committed extracted-text, HTML and dataset fixtures
data/events/            committed dataset, one JSON file per event
data/rosters/           per-season `class:plate` → rider roster, 2020–2026
data/derived/           the six analysis files, rebuilt from data/events
docs/                   source inventory, analyses and ADRs
scripts/                survey.js, lt-season.js, roster.js, derive.js, site.js, serve.js
.github/workflows/      test (push/PR), ingest (manual, poppler) and pages (deploy the site)
```

## Commands

```bash
npm test                                   # fixtures only: no network, no poppler
node src/build.js --event M2405            # real ingest; needs poppler
node src/build.js --event M2405 --offline  # rebuild from cache/
npm run survey -- --years 2020,2021        # ingest every round, report refusals
node scripts/lt-season.js --years 2025     # 2025 LiveTime season + roster
npm run roster                             # rebuild every season roster from committed data
npm run derive                             # rebuild data/derived from the committed events
npm run site                               # copy data/derived into site/data
npm run check                              # tests + stale-derived check + site data check
node scripts/serve.js                      # preview the site on http://127.0.0.1:8099
```

`PDFTOTEXT=/path/to/pdftotext` overrides extractor resolution. Otherwise
`.tools/poppler-*/Library/bin/pdftotext.exe` is used when present, then `pdftotext` from `PATH`.
Set it explicitly if a stray xpdf `pdftotext` is installed: the extractor is part of the parser
contract, because fixtures are its output.

## Analyses

Six analyses are built from `data/events` by `src/derive`, committed to `data/derived`, and published
as a static site in `site/`. `docs/analyses.md` gives each method and its coverage; ADR 0006 records
the decisions behind them.

| # | Analysis | Coverage | Notes |
|---|---|---|---|
| 6.1 | Lap chart | 2025–2026 only | no per-lap position exists before 2025 |
| 6.2 | Fade | 2020–2026 | time-based, so it needs no position |
| 6.3 | Lap 1 | 2021–2026 | 2020 prints no lap-1 time at all |
| 6.4 | Qualifying | 2020–2026 | rider must appear in qualifying and the motos |
| 6.5 | Titles | 2020–2026 | points computed from finishing positions |
| 6.6 | Ratings | 2020–2026 | Elo per class, one rating across all seasons |

The site is plain HTML, CSS and ES modules with no client dependency. `npm run site` copies the
derived files into `site/data/` (git-ignored, so there is one copy of the numbers in the repository),
and `.github/workflows/pages.yml` tests, verifies the derived files are current, and deploys `site/`
to GitHub Pages. Pages has to be set to deploy from GitHub Actions in the repository settings.

## Guarantees

- **Byte-identical rebuilds.** Keys are sorted at every level, no timestamps are stored, and
  non-finite numbers throw. Building `M2405` twice and comparing with `cmp` produces no diff, and
  `npm run derive -- --check` fails if the committed analyses no longer match the dataset.
- **The gate is a gate, and it separates two kinds of finding** (ADR 0004). Structural
  contradictions the parser controls — duplicate or non-contiguous positions, duplicate plates, a
  missing rider id, a malformed source hash — fail the build. Anomalies in the source itself — an
  implausible lap time, a `best lap` that is not in the lap list, a lap number printed twice,
  qualifying order that does not follow the times — are warnings: the dataset records what the
  sheet says and names the anomaly. There are 1,090 of them (1,066 from the PDF era, 24 from
  LiveTime), all in the committed data.
- **Provenance without artefacts.** `sources[]` records each source page's URL and sha256; the
  PDFs and mirrored HTML are never committed.
- **Positions only where the source has them.** A lap may carry `position` (schema 2). 2025–2026
  prints one per lap; 2020–2024 has none, and none is derived — a retro-fitted position would look
  authoritative and be wrong.

## Not in this repository

- Raw PDFs or mirrored pages, ever. Only derived data, small extracted-text fixtures and a manifest
  of what was fetched.
- Series logos, trademarks as branding, or anything beyond names and race results.
- Personal data beyond riders' names and their results.

## Local prerequisites

- **Node** — build scripts and tests. CI pins Node 20; the code stays 20-compatible.
- **Poppler** (`pdftotext`) — only for a real ingest, not for `npm test`.
