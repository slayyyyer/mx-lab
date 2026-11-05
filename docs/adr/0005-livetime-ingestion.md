# 5. Ingest 2025–2026 from LiveTime, with per-lap positions

Status: accepted (2026-11-04)
Related: ADR 0002 (dataset format), ADR 0003 (second source), `docs/sources.md` §15

## Context

ADR 0003 established that 2025–2026 live on `results.promotocross.com` and that
per-lap times **and per-lap positions** are available there, unlike the PDF era.
It stopped short of ingestion: the parser and source adapter were not written.

Surveying the actual pages added facts that shape the ingest:

- The `/events/` index lists every event across every season with a date, and is
  the only sane discovery path. Event hubs then link their own reports; the
  `p=` values cannot be constructed (ADR 0003).
- Moto reports carry three different link labels for the same report: `250 Moto 1`,
  `250 Class Moto 1` (2025 opener) and `250 Class Moto #1` (2026).
- One page per moto holds both the result row and that rider's own lap table, so
  there is no two-sheet join like the PDF era needs.
- `INTERVAL` is **not** laps completed — see §15.2 — and the results table appends
  ` Holeshot` to the winner's name.
- The index also lists side events (`WMX`, `Moto Combine`) that are not rounds of
  either championship.

## Decision

1. **A separate adapter, one shared output.** `src/sources/promotocross.js`
   discovers, `src/parse/lt.js` parses, `src/build-lt.js` assembles, and both eras
   finish in `finalizeEvent` so the dataset shape cannot drift.
2. **Dataset ids `LT<YY><NN>`**, one per championship round, 11 per season for
   2025 and 2026. Side events are excluded by name, explicitly, not by accident.
3. **Schema 2**: a lap may now carry `position`. It is optional, so every
   2020–2024 dataset stays valid and unchanged apart from the version number.
   Where a rider retired and the source prints no position, the value is `null`;
   it is never interpolated.
4. **A season roster per year** (`data/rosters/<year>.json`), built for every season by
   `scripts/roster.js` from committed events (ADR 0005 addendum: the PDF era needed it too,
   because a name can spill into the next column; see `docs/sources.md` §16): plate → rider. A
   number is unique **per class**, not per season (`#1` is one rider in 450 and a
   different one in 250), so roster keys are `class:plate`. The roster is what
   lets a rider be identified across events when a sheet lists a number without a
   usable name, and what makes a genuine number conflict visible.
5. **`scripts/lt-season.js` is the season build**, writing both datasets and the
   roster. `node src/build.js` stays the PDF-era CLI.

## Consequences

- 22 more events: 3,521 result rows and 51,638 per-lap times, every one of which
  carries a position.
- The eras are **not** symmetric and the site must say so: position-per-lap
  analyses were 2025–2026 only when this was written; the 2020–2024 `LAP CHART`
  sheets were later inverted into positions (amended 2026-11-05, see ADR 0006),
  while lap-time analyses cover 2020–2026.
- Name normalisation now matters: `HAIDEN DEEGAN Holeshot` must become
  `Haiden Deegan`, or one rider becomes two identities across a season.
- The roster is derived data with a schema of its own; it is rebuilt by the same
  script and committed, so a plate conflict shows up in a diff rather than in a
  later analysis.
- Both seasons ingest with no refusals. The gate warnings are almost entirely
  red-flag laps (~20 minutes) that the source really does print.
