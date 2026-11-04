# Backtests — design, fixed before results

This file is committed **before** any backtest output exists. `data/derived/backtests.json` and the
Backtests page are generated from this design; if the design changes later, the change is recorded
here with its date and reason, and earlier numbers are not silently overwritten.

## Question

Before a moto, how well can the information already in the dataset predict its outcome — and does
the rating model earn its place against simpler baselines?

## Targets

Measured per rider per moto:

| Target | Definition |
|--------|------------|
| Finish position | the official finishing position (integer MAE, rank correlation) |
| P(win) | finishes 1st |
| P(podium) | finishes 1st–3rd |
| P(top 10) | finishes 1st–10th |

Riders with `DNF`/`DSQ`/`DSNP` have no finishing position. They are excluded from position MAE and
Spearman, but they are **included** in the probability targets as failures (not a win, not a
podium, not a top 10). `DNS` removes the rider from the moto entirely, because they were never
going to finish.

## Baselines

Each uses only information available strictly before the moto is scored:

1. **Field average** — every rider equally likely: `1/n`, `3/n`, `10/n`, expected position `(n+1)/2`.
2. **Points rank** — championship points in the class before the moto, ranked among the riders in
   this moto. Unscored riders rank below scorers.
3. **Qualifying rank** — the event's qualifying position, ranked among the riders who line up in
   this moto (the whole entry list is not used). Available before moto 1 and still prior for moto 2.
4. **Lap-1 position** — the rider's rank by lap-1 time in this moto. This is **post-lap-1**, not
   pre-race, and every result using it is labelled that way. It is a reference for how much the
   opening lap already settles, not a pre-race forecast.
5. **Rating rank** — the class Elo rating before the moto, ranked among this moto's riders.

Probabilities for the four rank-based baselines come from a walk-forward frequency table: for each
rank bucket (1–25) the model counts how often that rank won / podiums / top-tens in **previous**
motos only, smoothed toward the running base rate with a pseudo-count of 8. This is deliberate: it
lets a rank baseline produce calibrated probabilities without inventing a functional form, and it
cannot see the moto it is predicting.

**Oracle** (winner is 1.0, everyone else 0.0) is computed only as a sanity check on the metric code.
It is never presented as a model.

## Metrics

- **MAE** of finishing position.
- **Spearman rho** between predicted order and finishing order, per moto; the report shows the
  median across motos and the share of motos with rho ≥ 0.5.
- **Brier score** for each probability target: mean of `(p − y)²`.
- **Log loss**: mean of `−[y·ln p + (1−y)·ln(1−p)]`, with `p` clipped to `[1e-6, 1−1e-6]`.
- **Brier skill score** `1 − Brier_model / Brier_reference`, reported against the field average and
  against the best of the four rank baselines.
- **Calibration**: ten equal-width probability bins, each with its count, mean predicted probability
  and observed frequency. A binned table is shown for win, podium and top 10.
- **95% intervals**: 1,000 bootstrap resamples of motos (seeded generator, so the output is
  reproducible), percentile method. Intervals are on Brier skill and on MAE.

## Validation scheme

- **Walk-forward, strictly chronological.** Events are ordered by date then id; motos within an
  event by class then moto number. A prediction for moto *k* may use only motos before *k*.
- **Per class.** Ratings and points ranks are per class; a 250MX result never informs a 450MX
  prediction.
- **No round-level lookahead.** Moto 2 predictions use moto 1 of the same round (it is in the past),
  but never the round's own moto 2 result or any later round.

## Minimum samples

- A moto is scored only if at least **8** riders have a finishing position.
- Aggregates are published only for groups with at least **50 scored motos**.
- Any cell with 30–49 motos is shown with a `small sample` flag; below 30 it is reported as
  `insufficient data` rather than ranked.
- Calibration bins with fewer than 20 predictions are shown but marked thin.

## Leakage tests

Run in `tests/backtest.test.js` on synthetic seasons:

1. **Oracle sanity** — the oracle's Brier score is below 0.01 and its MAE is 0. If not, the metric
   code is wrong.
2. **Shuffled labels** — permuting each moto's outcomes across its riders (deterministically) must
   collapse skill: `|skill vs field| < 0.05`. A predictor that still scores after the labels are
   shuffled is reading something it should not.
3. **Time shift** — replacing every feature with the *next* moto's value must not improve on the
   field average; a model that benefits from future information fails here.
4. **Determinism** — two runs over the same input produce byte-identical output.

## What will be reported even if unfavourable

Every pre-registered metric for every model, including cases where the rating does not beat points
rank or qualifying rank. The Ratings page must then say so in plain words.

## Known limitations, stated up front

- The dataset has no weather, track condition, injury, or penalty data, so no model can use them.
- Qualifying coverage is uneven by season, and the qualifying sheet lists non-qualifiers, so the
  qualifying baseline is computed only among riders who made the motos (see Priority 4 in the
  handoff).
- Lap-1 coverage is 0% in 2020 and partial elsewhere, so the lap-1 baseline covers fewer motos.
- Positions are exact, but the source sheets are provisional results; a post-race penalty that was
  applied later would be invisible here.
