# ADR 0003 — Second source for 2025–2026, and what per-lap data actually exists

- **Status:** accepted for discovery; ingestion implemented in ADR 0005
- **Date:** 2026-11-04
- **Related:** ADR 0001, `docs/sources.md` §12

## Context

The AMA PDF archive stops at 2024 (verified: `/live/archives/mx/2025/` is a
404 and the last event is `M2455`). Seasons 2025–2026 are therefore served by a
different system: `results.promotocross.com`, a LiveTime Scoring Engine app.

My first pass concluded that per-lap data might not exist there: guessed report
names all returned 404 and no lap-time strings appeared in the box score. That
conclusion was wrong, and the reason matters — the report type is
`view_race_result`, it is **linked** from each event page (28 links on the
Ironman event), and the earlier 404 came from building the URL by hand instead
of following the link. Retried correctly:

```
GET https://results.promotocross.com/results/?p=view_race_result&id=6078509
200, 1,393,052 bytes, <title>… Ironman – Crawfordsville, IN :: 250 — </title>
```

That page contains a per-rider `Lap Times` table with `#`, `LAP TIME`,
`TIME OF DAY`, `SECTORS`, `PACE`, and a **position column per lap** (`38th`,
`37th`, …), plus the JS payload carrying `'pace' : '4/15:30.383'` (lap 4 at
15:30.383 wall clock — not a lap time; the lap time is the adjacent field).

## Decision

1. **2025–2026 comes from `results.promotocross.com`**, discovered by following
   `p=view_event` and then the report links it emits. Never construct a report
   URL by hand: the same `p=` value returns 404 without the right parameters.
2. **Per-lap times and per-lap positions both exist for 2025–2026**, directly
   from the timing system. This is better data than 2020–2024.
3. **Ingestion is a separate parser and a separate source adapter.** It is not
   built yet; this ADR records the decision and the verified evidence so the
   work does not start from the false premise that the data is missing.

## What this means for the analyses (important scope consequence)

The two eras are not symmetric, and the site must say so:

| Analysis needs | 2020–2024 | 2025–2026 |
|---|---|---|
| Per-lap **times** | Yes, with gaps (see below) | Yes |
| Per-lap **positions** | **No** | Yes, direct |
| Qualifying best laps | Yes (whole entry list) | Yes |
| Moto/overall results | Yes | Yes |

Per-lap positions for 2020–2024 are **not recoverable**. The lap chart sheet
does not hold positions (see `docs/sources.md` §7.2, corrected), and cumulative
lap times cannot reconstruct them either, because lap 1 has no time: sums from
lap 2 onward give relative gaps, not absolute track position. So:

- Analyses that need position-per-lap (lap chart, position fade) can only be
  built for 2025–2026, or must be redefined as time-based for 2020–2024.
- Analyses that need lap times only (lap-time fade, lap-1 value) can cover
  2020–2024, provided they handle the missing-final-lap gap.

This is a scope decision for Justin, not something to paper over with a derived
position that looks authoritative.

## Open questions

- Is there a documented licence or terms for the LiveTime data? The host
  `promotocross.com` has a robots.txt that disallows only account/comment/CDN
  paths, and no terms page was found for the results subdomain. The working
  assumption stays conservative: derived statistics and link-backs only.
- 2022 also exists on this platform. It is *not* proposed as a replacement for
  the PDFs for 2022 — one source per season keeps row provenance unambiguous.
