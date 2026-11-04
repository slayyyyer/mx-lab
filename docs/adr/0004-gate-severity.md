# 4. The gate fails on contradictions, warns on source anomalies

Status: accepted (2026-11-04)

## Context

ADR 0001 made the gate the main defence against the dominant risk: a parser that
silently misreads a sheet and publishes plausible-looking wrong numbers. The
first version of `src/validate.js` therefore failed the build on anything it
could not reconcile — including values the source itself prints.

Building the full 2020–2024 archive made that unworkable. Of 44 surveyed events,
33 were refused, and every refusal was a real property of the sheet rather than a
parse failure:

- `#117` lap 3 at Loretta Lynn's 2020 is printed as `29:24.473` (a whole moto on
  one lap, after a red flag).
- Three 2020 rounds print a rider's final lap number twice.
- Qualifying at Hangtown 2021 publishes `136722ms` for `#241` while the fastest
  listed session is `142808ms`.
- Half the sheets omit the final lap and print `MIN` in its slot instead.

None of these can be "fixed" by better parsing, and all of them are worth
publishing *as recorded*.

## Decision

Two severities, and only one of them fails a build.

**errors** — a contradiction the parser itself controls:

- duplicate or non-contiguous finish positions
- duplicate plates within a moto
- a missing rider id
- a malformed source hash

**warnings** — an anomaly in the source, carried in the dataset's `warnings[]`:

- an implausible lap time, kept exactly as printed
- a published best lap that is not in the rider's lap list
- a lap number printed twice (the later entry is dropped, never renumbered)
- a lap time missing from the sheet, or absent entirely for a rider
- qualifying order that does not follow the printed times, or a best time faster
  than every listed session

## Consequences

- A build never rewrites a value to look plausible, and never fails because the
  source is odd. 55 events ingest with 1,066 warnings and no refusals.
- Warnings are data, not noise on stderr: they are committed with the event, so a
  reader can see what the sheet actually said.
- A structural contradiction still stops the build. The distinction is tested in
  `tests/validate.test.js` ("a recorded source gap is a warning, not an error").
- The gate is weaker against a *misparse that happens to look structural* than a
  strict gate would be. That is covered by fixtures for each layout family and by
  the contiguous-positions requirement, not by severity.
