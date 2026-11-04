# Rules the analyses depend on

This file records the competition rules the derived numbers assume. Where a rule cannot be
established from the dataset or from a citable published rulebook, this file says so rather than
inventing one.

## Points

Each championship moto pays the same 20 places:

| Pos | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|-----|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|----|----|----|
| Pts | 25 | 22 | 20 | 18 | 16 | 15 | 14 | 13 | 12 | 11 | 10 | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 |

This is the table the site applies (`POINTS_TABLE` in `src/derive/common.js`). It is a derived
number: the timing sheets publish finishing positions, not points, and the site says so on every
page that shows a total.

## Non-finishes

| Status | Meaning | Points | Counts as a moto started |
|--------|---------|--------|--------------------------|
| `DNF`  | Started, did not finish | 0 | Yes |
| `DNS`  | Entered, did not start | 0 | No |
| `DSQ`  | Disqualified | 0 | Yes, for the record; excluded from averages |
| `DSNP` | Did not start the parade/qualifier | 0 | No |

The dataset carries these as a `status` string from the source sheet. A rider with a `DNS` row is
not in the results sheet at all in most rounds, so the common case is a rider simply missing from
a round rather than a `DNS` row.

## Tie-breaks

Standings ties are broken by **countback**: most wins, then most second places, then most third
places, and so on down the finishing positions. This is the order used by the series and by
`src/derive/titles.js`.

**What the dataset cannot answer.** If two riders are identical on every countback position (same
number of wins, seconds, thirds, ... and the same points), the published championship order depends
on a further rule that is not recorded in this repository — for example a penalty applied by race
control, or a drawing of lots. The dataset does not carry penalties, so:

- the solver reports such a tie as **exactly tied** and says the order is not determined by the
  data;
- the standings table orders exact ties by rider id **for display only**, and marks them `tied`;
- no page claims that display order is the official classification.

Earlier versions of the site ended the tie-break at rider id without saying so. That was a
presentation order presented as if it were a rule, and it has been removed from the method text.

## DNF handling in analyses

| Analysis | DNF/DNS treatment |
|----------|-------------------|
| Titles / standings | DNF scores 0 and counts as a start; DNS is not a start |
| Ratings | DNF is a loss to every finisher; DNS removes the rider from that moto |
| Fade | DNF has no usable second half, so it is skipped and counted |
| Lap 1 | DNF rows have a lap-1 time only if they completed lap 1 |
| Qualifying | a rider who did not make the motos has no paired finish |
| Backtests | target is the official finishing position; DNF is excluded from position MAE and included in `P(finish)` as "not top 10" |

## Sources for the rules

- Points table and countback order: AMA Pro Racing / MX Sports Pro Racing supplementary regulations
  for the 2024 season, as summarised in `docs/sources.md` §Rules. These are competition regulations,
  not results; no text from them is reproduced here.
- The per-round structure (two motos per class per round, 30 minutes + 2 laps) is visible in the
  dataset's own sheet titles, e.g. `PROVISIONAL RESULTS - 450MX MOTO #1 (30 MINUTES + 2 LAPS)`.

## Verification status

- Points table: **verified** against every season's standings shape (a season of full finishes adds
  to the expected total).
- Countback: **verified** against synthetic seasons in `tests/derive.test.js` and applied to the
  published standings.
- Final tie-break: **not determined**. Reported as a tie rather than resolved.
