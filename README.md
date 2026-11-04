# mx-lab

One clean, validated dataset of AMA Pro Motocross results, and six analyses published on top of it.

**Unofficial.** This project is not affiliated with or endorsed by AMA Pro Racing, MX Sports, Pro
Motocross, or any series, team or rider. Series names appear in plain text only; no logos or marks
are used. Results are attributed to their timing and scoring providers.

> **Status: source verification complete, pipeline not yet built.**
> Nothing in this repository is a finished dataset yet. What exists is the verified source
> investigation (`docs/`) that the pipeline will be built against. See `docs/sources.md` for the
> evidence behind every claim about the sources.

## Sources (verified 2026-11-04)

| Seasons | Source | Format | What it provides |
|---|---|---|---|
| 2020–2024 | `americanmotocrossresults.com` (AMA Pro Racing / LiveTime PDF archive) | PDF, one file per session | Results, per-lap segment times, **lap chart with position per lap**, qualifying best laps |
| 2022–2026 | `results.promotocross.com` (LiveTime Scoring Engine) | Server-rendered HTML + PDF export | Box score (moto + overall positions, laps led, points), qualifying, entry lists |

- The two PDF hosts in the AMA archive (`americanmotocrossresults.com` and
  `live.amaproracing.com`) are the **same backend** — byte-identical files. One origin is used.
- There is an XML manifest beside the PDFs (`<EventID>SchedRes.xml`), but it holds **links and
  schedule only, no result values** — see `docs/adr/0001-result-source.md`.
- The AMA PDF archive **ends at 2024**, which is why a second source is required for 2025–2026.

## Not in this repository

- Raw PDFs or mirrored pages, ever. Only derived data and a manifest of what was fetched.
- Series logos, trademarks as branding, or anything beyond names and race results.
- Personal data beyond riders' names and their results.

## Layout

```
docs/sources.md            per-sheet source inventory, discovery, coverage, terms, hazards
docs/adr/                  decision records
```

## Local prerequisites

- **Node** — build scripts and the test harness. CI pins Node 20; keep the code 20-compatible.
- **Poppler** (`pdftotext`) — PDF text and coordinate extraction. Not xpdf: the lap chart needs
  `-bbox-layout`, which xpdf's `pdftotext` does not support (verified).

Run the extraction step with an explicit Poppler path so a stray xpdf on `PATH` cannot silently
change output — parser fixtures are derived from extractor output, so the extractor version is part
of the contract.
