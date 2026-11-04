# ADR 0006 — The six analyses, and the era split they have to live with

- **Status:** accepted
- **Date:** 2026-11-04
- **Related:** ADR 0001, ADR 0003, ADR 0005, `docs/analyses.md`

## Context

ADR 0003 left one decision to Justin: the 2025–2026 source prints a position on every lap, the
2020–2024 source does not, and three of the six analyses were written as position analyses. The
choice was between confining them to two seasons and redefining them as time questions.

The dataset settles the scale of the problem: 51,432 laps carry a position and every one of them is
in 2025–2026. For 2020–2024 there is no per-lap position to recover — the lap chart sheet holds
plates, not places, and cumulative lap times give relative gaps rather than track position because
lap 1 has no time to sum from.

A second, smaller surprise came out of the analysis code: **2020 has no lap-1 times at all**. Not
"some riders are missing lap 1" as in 2021–2024, but `--.---` for all 1,400 rows. So 6.3 cannot
honestly claim seven seasons either.

## Decision

1. **6.2 (fade) and 6.3 (lap 1) are time analyses over all seasons they can support.** Fade asks how
   much pace drops late in a moto; that is measurable from lap times and does not need a position.
   Lap 1 is measurable wherever the sheet prints a lap-1 time, which is 2021 onwards. Both are
   labelled with their coverage, and 6.3 reports coverage next to every correlation.
2. **6.1 (lap chart) is a position analysis for 2025–2026 only**, and the page says so above the
   chart rather than starting in 2025 without comment.
3. **Championship points are computed, not sourced.** Neither source publishes points. The standard
   moto table (25-22-20-18-16, then one fewer per place to 20th) is applied to finishing positions,
   both motos score, a DNF scores 0. Every surface that shows points says they are computed. This is
   the one place the project adds a convention rather than reading one, and it is recorded here so
   it is not mistaken for source data.
4. **Ratings are Elo within a class, continuous across seasons.** K = 32 spread across the field,
   new entrants at the class median, all deltas for a moto applied from one snapshot. The parameters
   are arbitrary but fixed, documented, and the same for every rider — which is what makes the table
   inspectable rather than mysterious.
5. **Derived files are committed** (`data/derived/`), and CI fails if they no longer match
   `data/events/`. Committing them keeps a reviewable record of what the site will say; the check
   keeps them from going stale when the parser changes.
6. **The site is static HTML, CSS and ES modules.** No framework, no build step, no client
   dependency. Pages read the derived JSON at runtime from `site/data/`, which is generated and
   git-ignored, so there is exactly one copy of the numbers in the repository.

## Consequences

- Five analyses cover seven seasons; the lap chart covers two. The site states this on the overview
  and on the lap chart itself, so a reader cannot mistake a two-season chart for a seven-season one.
- 6.3's season table is not comparable season to season without reading the coverage column: 2021's
  rho describes roughly a fifth of the field.
- A rider's rating is only as meaningful as the field they met. Cross-class comparison is explicitly
  refused on the page.
- Adding a season means re-running `npm run derive` and committing both the events and the derived
  files; forgetting the second is caught in CI, not on the live site.

## Rejected

- **Deriving positions for 2020–2024 from cumulative lap times.** It produces a number that looks
  like a position, is not one, and would silently mix two different measurements under one label.
- **Scoring points from a published standings page.** It would tie the dataset to a third source
  with no parsing contract, to save a 20-entry table.
- **Computing the site at build time only.** Then `data/derived/` would not exist to review, and the
  analysis layer would have no artefact in the repository.
- **A framework for the site.** Six pages and two chart shapes do not need one, and a dependency-free
  site has no build to break.
