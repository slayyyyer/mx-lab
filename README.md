# mx-lab

One clean, validated dataset of AMA Pro Motocross results, and six analyses published on top of it.

**Unofficial.** This project is not affiliated with or endorsed by AMA Pro Racing, MX Sports, Pro
Motocross, or any series, team or rider. Series names appear in plain text only; no logos or marks
are used. Results are attributed to their timing and scoring providers.

> **Status: the whole 2020–2024 PDF archive is ingested.** 55 events, 8,720 result rows and
> 123,238 per-lap times, from 546 hashed source PDFs; no event is refused by the gate. The 2025–2026
> adapter is designed and its data verified, but not yet written (ADR 0003). The six analyses and
> the site are not started.

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

| Season | Events | Result rows |
|---|---|---|
| 2020 | 9 | 1,400 |
| 2021 | 12 | 1,920 |
| 2022 | 12 | 1,880 |
| 2023 | 11 | 1,760 |
| 2024 | 11 | 1,760 |

Every event in the archive's own `M<YY><NN>` numbering from 2020 to 2024 parses; `npm run survey`
is how that claim is checked, per season.

## Layout

```
src/
  build.js              event assembly (pure) + networked build CLI
  validate.js           the gate: contradictions fail, source gaps warn
  identity.js           rider slugs and overrides
  lib/                  text/time helpers, deterministic JSON, HTTP cache, poppler wrapper
  parse/                results, lap-times and qualifying sheet parsers
  sources/ama.js        manifest discovery, sheet kinds, event ids
tests/
  harness.js, run.js    dependency-free test harness
  *.test.js             36 assertions over committed extracted-text fixtures
data/events/            committed dataset, one JSON file per event
docs/                   source inventory and ADRs
.github/workflows/      test (push/PR) and ingest (manual, poppler)
```

## Commands

```bash
npm test                                   # fixtures only: no network, no poppler
node src/build.js --event M2405            # real ingest; needs poppler
node src/build.js --event M2405 --offline  # rebuild from cache/
npm run survey -- --years 2020,2021        # ingest every round, report refusals
```

`PDFTOTEXT=/path/to/pdftotext` overrides extractor resolution. Otherwise
`.tools/poppler-*/Library/bin/pdftotext.exe` is used when present, then `pdftotext` from `PATH`.
Set it explicitly if a stray xpdf `pdftotext` is installed: the extractor is part of the parser
contract, because fixtures are its output.

## Guarantees

- **Byte-identical rebuilds.** Keys are sorted at every level, no timestamps are stored, and
  non-finite numbers throw. Building `M2405` twice and comparing with `cmp` produces no diff.
- **The gate is a gate, and it separates two kinds of finding** (ADR 0004). Structural
  contradictions the parser controls — duplicate or non-contiguous positions, duplicate plates, a
  missing rider id, a malformed source hash — fail the build. Anomalies in the source itself — an
  implausible lap time, a `best lap` that is not in the lap list, a lap number printed twice,
  qualifying order that does not follow the times — are warnings: the dataset records what the
  sheet says and names the anomaly. There are 1,066 of them, all in the committed data.
- **Provenance without artefacts.** `sources[]` records each PDF's URL and sha256; the PDFs
  themselves are never committed.

## Not in this repository

- Raw PDFs or mirrored pages, ever. Only derived data, small extracted-text fixtures and a manifest
  of what was fetched.
- Series logos, trademarks as branding, or anything beyond names and race results.
- Personal data beyond riders' names and their results.

## Local prerequisites

- **Node** — build scripts and tests. CI pins Node 20; the code stays 20-compatible.
- **Poppler** (`pdftotext`) — only for a real ingest, not for `npm test`.
