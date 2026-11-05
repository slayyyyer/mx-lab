# The six analyses

Everything here is computed from `data/events/*.json` by `src/derive/`, written to
`data/derived/*.json` by `npm run derive`, and rendered by the static site in `site/`.

Two rules apply to all six:

- **A number is only produced where the source has it.** Where a season lacks the input, the
  analysis says so on the page rather than starting quietly later or interpolating.
- **Derived files are committed and checked.** `npm run derive -- --check` fails if
  `data/derived/` no longer matches `data/events/`, and the Pages workflow runs that check before
  deploying.

The dataset is now both series: 195 events, 17,434 result rows and 250,699 per-lap times, covering
Motocross 2020–2026 and Supercross 2020–2026.

| # | Analysis | File | Coverage | Needs per-lap position? |
|---|---|---|---|---|
| 6.1 | Lap chart | `lap-chart.json` | 2020–2026, both series (2020–2024 from the LAP CHART sheet) | yes |
| 6.2 | Fade | `fade.json` | 2020–2026, 14,468 rider-motos | no |
| 6.3 | Lap 1 | `lap-one.json` | 2020–2026 (2020 Motocross absent) | no |
| 6.4 | Qualifying | `qualifying.json` | 2020–2026, 322 sheets | no |
| 6.5 | Titles | `titles.json` | 2020–2026, both series | no |
| 6.6 | Ratings | `ratings.json` | 2020–2026, both series | no |

## 6.1 — Lap chart

**Question.** Where was each rider on each lap?

**Method.** Read the position the timing system prints on every lap row for 2025–2026. For
2020–2024, invert each moto's `LAP CHART` sheet: its rows are finishing positions and its cells are
plate numbers, one column per lap, so a plate's position on a lap is the row its number sits in. Both
series publish that sheet (`M1F1LAP`, `S1F1LAP`, …). The file keeps the top twenty finishers of each
moto; a full forty-line chart is unreadable and the lapped riders are exactly the ones whose printed
position needs care.

**Coverage.** 2020–2026: 176 events, 489 motos and 162,158 charted lap positions. The only rounds
without them are Triple Crown events (13 in 2020–2024, six in 2025–2026), which publish three
separate mains and no single chart, and whose overall classification carries no lap times. No
position is estimated.

## 6.2 — Fade

**Question.** How much does a rider slow down between the first and second half of a moto?

**Method.** Take laps 2 to the end of the moto, drop laps slower than 1.4× the rider's own median
(a pit stop or a crash, not fading), then compare the median of the second half with the median of
the first. A moto needs at least six usable laps on each side of the split. Result: a percentage.

Median rather than mean so one bad lap cannot decide the answer; percentages rather than seconds so
a 1:10 track and a 2:20 track are comparable.

**Coverage.** All seven seasons and both series: 14,468 rider-motos measured, with the rest skipped
for too few laps and counted in `coverage.riderMotosSkipped`.

**Reading it.** The leaderboard needs ten measured motos in a season. Differences in the second
decimal are stopwatch noise, not fitness.

## 6.3 — Lap 1

**Question.** Does the opening lap already decide the finishing order?

**Method.** Per moto, rank the riders who have a lap-1 time by that time and by finish, and take
Spearman's rho. Report the median rho per season and the share of motos above 0.5.

**Coverage.** **2020–2026, with one gap.** 2020 Motocross prints `--.---` for lap 1 for the entire
field, so none of that season's Motocross rows has a lap-1 time; the 2020 Supercross rounds do print
it. 2021–2024 Motocross has one for part of the field (about 17–25% of rows), 2025–2026 for nearly
all of it. Every season line on the site reports its own coverage, and a moto needs eight riders with
a lap-1 time to be measured at all.

**Caveat.** This is a correlation within a moto, not a causal claim: fast starters are usually fast
riders.

## 6.4 — Qualifying

**Question.** What is a fast qualifying lap worth once the gate drops?

**Method.** Within an event and class, join the qualifying sheet to the moto results by rider, then
compute qualifying position minus mean finishing position. Positive means the rider gained places.
Also report Spearman's rho between qualifying position and mean finish per event.

**Coverage.** All seven seasons and both series, 322 qualifying sheets. The qualifying sheet lists
the whole entry list, so riders who did not make the motos are excluded — otherwise "gained places"
would be dominated by riders who never raced. A Supercross 250 sheet prints the coast on the plate
(`1W`), which is what makes the class join correctly.

## 6.5 — Titles

**Question.** Who won, when did they clinch, and how did the points race move?

**Method.** Points are **computed from finishing positions** using the standard AMA Pro Motocross
moto table: 25, 22, 20, 18, 16, then one fewer per place down to 1 for 20th. Both motos of every
round score. A DNF scores 0 and still counts as a moto started, so a rider's average finish is not
flattered by dropping bad races. Ties break on wins, then best finish, then rider id.

The clinch round is the first round after which the leader's advantage is greater than the points
still available, at 50 per round.

**Supercross.** A 250 title is scored per coast (`250SX East`, `250SX West`). An East/West showdown is
recorded but not scored, because it races two championships at once. Triple Crown rounds classify on
an overall sheet whose printed award is used instead of the table where it exists.

**Coverage.** All seven seasons and both series. Derived champions: 2020 Tomac (450SX), Sexton/Ferrandis
(250SX East/West), Osborne and Ferrandis (MX); 2021 Webb, Nichols/Cooper; 2022 Tomac, Jett Lawrence and
Craig; 2023 Sexton, Hunter and Jett Lawrence; 2024 Jett Lawrence, Vialle/Kitchen; 2025 Webb, Deegan and
Vialle, Jett Lawrence and Deegan (MX); 2026 Roczen, Deegan and Davies, Hunter Lawrence and Davies (MX).

**Caveat.** A published standings total may differ where a series applied a tie-break or a penalty
that the results sheets do not show. The site labels these as computed.

## 6.6 — Ratings

**Question.** How good is each rider relative to the riders they actually raced?

**Method.** Elo, per class, over every moto: within a moto every finisher is compared with every
other finisher, with K = 32 spread across the field (K ÷ (n − 1) per pairing) so a 40-rider moto does
not move a rating forty times as far as a two-rider one. All deltas for a moto are computed from the
pre-moto snapshot and applied together, which makes the result independent of pair order.

A rider new to a class enters at that class's current median rating rather than a fixed 1500, so the
scale does not drift as the field grows. One rating per class runs across all seasons, so a number
change does not restart it.

**Coverage.** Both classes and both series, all seasons; leaderboards need ten motos. Ratings are not
comparable across classes.

## What the site does not do

- No live scraping: the pages read the committed derived files.
- No imputation: a missing lap time, position or qualifying row stays missing.
- No claims about machinery, teams or fitness. These are results, not explanations.
- No raw PDFs or mirrored source pages, no series logos.

## Rebuilding

```bash
npm run derive          # data/events -> data/derived
npm run site            # data/derived -> site/data
node scripts/serve.js   # http://127.0.0.1:8099
npm run check           # tests, stale-derived check, site data check
```
