# ADR 0001 — Result source: parsed PDFs, not structured XML

- **Status:** proposed — awaiting Justin's sign-off (this ADR is written before the pipeline exists)
- **Date:** 2026-11-04
- **Deciders:** Justin Baker
- **Related:** `docs/sources.md` §3–§7

## Context

The handoff hoped that the `xml/…` paths beside the result PDFs meant structured result data
existed, and instructed us to prefer it if so, because structured data beats parsing PDFs.

Verification on 2026-11-04 found that this hope does not hold:

- `GET /xml/MX/events/<EventID>SchedRes.xml` (≈11.5 KB) **is** real XML, and it is genuinely useful
  — it carries event name, track, location, date, session start times and, per session, an `L`
  attribute pointing at that session's PDF.
- It contains **no lap times, no finishing positions and no points**. It is a file manifest and
  schedule, not a result set.
- There is no other structured endpoint: `/xml/MX/events.xml`, `/xml/MX/2024/events.xml` and
  `/<year>/events.html` are all 404. The event list for 2021–2024 is not published as static HTML
  at all; it is rendered client-side from the `EventID` query parameter.

So the choice is not "XML or PDF". It is "PDF, plus XML as the index" versus "no dataset".

## Decision

1. **Parse the PDFs** for all result values (results, lap times, lap-chart positions, qualifying).
2. **Use `SchedRes.xml` as the discovery/manifest layer**: it tells us which sheets exist for an
   event and when a session's results were published. It is not a data source for values.
3. **Store a per-file manifest** (source URL, `fetched_at`, `sha256`, `ETag`, `Last-Modified`,
   `parser_id`, layout fingerprint) so every committed row traces to an exact source artifact —
   even though the artifact itself is never committed.
4. **Extract with `pdftotext`** (poppler in CI), never a paid or install-heavy extractor. If a
   Python `pdfplumber`-class tool later proves materially better for the lap chart, that is a
   separate ADR and Justin's call, per the handoff.

## Consequences

**Good**

- The dataset is possible at all, from a single free origin.
- The manifest gives row-level provenance and re-parsability without shipping copyrighted PDFs.
- XML still removes the guesswork from filenames, which was a real risk (sheet codes do not
  reliably denote class — `docs/sources.md` §7.1).

**Bad / accepted risks**

- We own a parser per layout, and layouts drift by year (2020 vs 2022/2024 verified differences).
  Budget for versioned parsers that refuse unknown layouts.
- The **lap chart is the weak link**: plain-text extraction of it is unreliable, and two extraction
  modes disagree about which rider owns a row (`docs/sources.md` §7.2). Position-per-lap — which
  analyses 6.1, 6.2 and 6.3 depend on — needs coordinate-based parsing, which is not yet proven on
  the local toolchain.
- PDF parsing is the only route, so a silently misparsed sheet is the dominant correctness risk.
  This is precisely why the validation gate (derived finish order vs official, lap sums vs race
  time, points vs standings) is a gate rather than a warning.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Structured XML result values | Do not exist (verified). |
| Third-party mirror `americanmotocrossresults.com` as a *different* source | It is the **same backend**: byte-identical file served (identical sha256). Using both would double-fetch and create false "change" signals. |
| Racer X / Cycle News HTML results | Fine for spot cross-checks, not authoritative, and HTML scraping there is no more robust than the PDFs. |
| `promotocross.com` results database | Would be needed for 2025–2026, which this archive does not cover. Its robots.txt exists (200) and its terms source graph is unexamined — a separate ADR if v1 ever extends past 2024. |
| Python `pdfplumber` for everything | Better geometry model, but a second runtime and dependency surface; the handoff prefers the no-install `pdftotext` path. Revisit only if the lap chart proves impossible with poppler coordinates. |

## Open question this ADR cannot settle

Whether redistribution of **derived** statistics is acceptable. The results hosts publish **no
robots.txt (404) and no terms-of-use or licence page**, so there is neither prohibition nor
permission (`docs/sources.md` §8). The working assumption is the conservative one: derived
statistics and link-backs only, never raw PDFs, never a mirror. If Justin obtains a definitive
answer, this ADR should be amended before the site is published.
