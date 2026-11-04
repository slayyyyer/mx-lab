# ADR 0002 — Dataset format: one JSON file per event, deterministic bytes

- **Status:** accepted
- **Date:** 2026-11-04
- **Related:** ADR 0001, `src/build.js`, `src/lib/json.js`

## Context

The analyses are static pages built from a committed dataset, and the handoff
requires that a re-run be byte-identical so a rebuild never shows a spurious
diff. Two forces pull against that:

1. Provenance. Every row should trace to an exact source artefact, which tempts
   us to store `fetched_at` timestamps in the data.
2. Untidy source. The sheets contain real gaps (a missing final lap, a DNF with
   no lap times), and a parser or a format that rounds those into zeroes or
   omits them silently would make analyses lie.

## Decision

1. **One JSON file per event**: `data/events/<EventID>.json`. Small enough to
   read in a browser, big enough to hold every sheet for that round.
2. **Deterministic serialisation** (`stableStringify`): object keys sorted at
   every level, 2-space indent, one trailing newline, arrays in a defined order
   (motos by class then moto number; riders by finishing position; laps by lap
   number). Non-finite numbers throw rather than serialise.
3. **No timestamps, no fetch metadata in the dataset.** `sources[]` holds only
   `url` and `sha256`, both deterministic. The richer provenance record
   (`ETag`, `Last-Modified`, byte counts, when it was fetched) stays in the
   git-ignored `cache/`, because putting a clock into the committed data would
   break byte-identical rebuilds for no analytical gain.
4. **Times are integer milliseconds.** `2:23.895` is `143895`. Text forms are
   kept only where the text itself is the fact (`gapRaw: "+1:44.995"`).
5. **Missing is `null`, never `0`.** Lap 1 has no time on the sheets and is
   stored as `null`. So is a gap for a rider a lap down, and a best lap for a
   DNF. A consumer that treats `null` as zero is choosing to be wrong, but the
   data never asserts a false measurement.
6. **The dataset carries its own disagreements.** `warnings[]` records source
   gaps (for example: 18 riders at Pala have 14 lap times for a 15-lap moto,
   because the sheet prints the `MIN` summary in the final lap's slot). Those
   are facts about the source, not build failures.

## Consequences

**Good**

- Rebuilding an event with the same source bytes produces an identical file;
  verified by building `M2405` twice and comparing (`cmp`).
- The file is diffable and reviewable: a parser change shows up as a data diff.
- Analyses can distinguish "no time recorded" from "zero seconds", which the
  lap-1 case makes unavoidable.

**Bad / accepted**

- No `fetched_at` in the dataset means the committed file cannot say *when* a
  source last changed. The hash pins *what* was read; regenerating is cheap.
- Warnings are duplicated data (the same fact is visible in `laps.length` vs
  `lapsCompleted`). Kept because a reader who does not diff counts will
  otherwise miss it.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| JSONL / one row per record | Harder to review a whole event; the analyses want the round together. |
| SQLite | A binary blob in git; no reviewable diffs. |
| YAML | Serialiser ambiguity and key-order temptation; JSON has one obvious canonical form. |
| Store raw extracted text in the repo | The handoff forbids shipping source artefacts; only small fixtures are committed. |
| Store `fetched_at` for provenance | Breaks byte-identical rebuilds (superseded by hash-only provenance). |
