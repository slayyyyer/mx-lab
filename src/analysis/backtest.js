// The shared backtest harness.
//
// Every model is scored on the same walk-forward pass: a prediction for a moto
// may only use data from motos before it. The design is pre-registered in
// `docs/backtests.md`; this module implements it and nothing beyond it.
//
// The rank baselines do not invent a probability formula. For each rank they
// count how often that rank won / reached the podium / reached the top ten in
// *previous* motos and smooth toward the running base rate. That way a baseline
// produces calibrated probabilities without assuming a shape, and it cannot see
// the moto it is predicting.

import {
  cmp,
  median,
  pointsFor,
  round,
  seasonOf,
  sortedEvents,
  sortedMotos,
  spearman,
} from '../derive/common.js';
import { eloMoto } from '../derive/ratings.js';

export const MIN_MOTOS = 8;
export const MIN_GROUP = 50;
export const BUCKET_MAX = 25;
const SMOOTHING = 8;

/** Deterministic generator, so a bootstrap interval is reproducible byte for byte. */
export function seededRandom(seed = 20260101) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function rankBy(rows, key) {
  const ordered = [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) {
      const order = cmp(ka[i], kb[i]);
      if (order !== 0) return order;
    }
    return 0;
  });
  return new Map(ordered.map((row, index) => [row.riderId, index + 1]));
}

function lapOneMs(row) {
  return (row.laps ?? []).find((lap) => lap.lap === 1)?.timeMs ?? null;
}

function entryRating(ratings) {
  const values = [...ratings.values()];
  if (values.length === 0) return 1500;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One chronological pass over every moto that is large enough to score.
 *
 * @returns {Array<{motoId:string, season:number, class:string, eventId:string,
 *   round:number|null, rows:Array, ranks:object, n:number}>}
 */
export function collectMotos(events) {
  const state = new Map();
  const motos = [];

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    const qualByClass = new Map();
    for (const qualifying of event.qualifying ?? []) {
      const map = new Map();
      for (const row of qualifying.rows ?? []) {
        if (Number.isInteger(row.pos)) map.set(row.riderId, row.pos);
      }
      qualByClass.set(qualifying.class, map);
    }

    for (const moto of sortedMotos(event)) {
      const rows = [...(moto.results ?? [])]
        .filter((row) => Number.isInteger(row.pos) && row.pos > 0)
        .sort((a, b) => a.pos - b.pos);

      if (!state.has(moto.class)) state.set(moto.class, { rating: new Map(), points: new Map(), starts: new Map() });
      const classState = state.get(moto.class);

      if (rows.length >= MIN_MOTOS) {
        const pointsRank = rankBy(rows, (row) => [
          -(classState.points.get(row.riderId) ?? 0),
          -(classState.starts.get(row.riderId) ?? 0),
          row.riderId,
        ]);

        const rated = rows.filter((row) => classState.rating.has(row.riderId));
        const fallback = entryRating(classState.rating);
        const ratingRank = rankBy(rows, (row) => [
          -(classState.rating.get(row.riderId) ?? fallback),
          row.riderId,
        ]);

        const qualPositions = qualByClass.get(moto.class) ?? new Map();
        const qualRows = rows.filter((row) => Number.isInteger(qualPositions.get(row.riderId)));
        const qualRank = new Map();
        rankBy(qualRows, (row) => [qualPositions.get(row.riderId), row.riderId]).forEach((rank, riderId) =>
          qualRank.set(riderId, rank),
        );
        for (const row of rows) if (!qualRank.has(row.riderId)) qualRank.set(row.riderId, qualRows.length + 1);

        const lapRows = rows.filter((row) => Number.isFinite(lapOneMs(row)));
        const lapRank = new Map();
        rankBy(lapRows, (row) => [lapOneMs(row), row.riderId]).forEach((rank, riderId) =>
          lapRank.set(riderId, rank),
        );
        for (const row of rows) if (!lapRank.has(row.riderId)) lapRank.set(row.riderId, lapRows.length + 1);

        motos.push({
          motoId: `${event.event.id}:${moto.class}:M${moto.moto}`,
          eventId: event.event.id,
          season,
          class: moto.class,
          round: event.event.round ?? null,
          n: rows.length,
          rows,
          ranks: { points: pointsRank, rating: ratingRank, qual: qualRank, lap1: lapRank },
          hasQual: qualRows.length > 0,
          hasLap: lapRows.length > 0,
          rated: rated.length,
        });
      }

      // Update after the snapshot: nothing above may see this moto's outcome.
      for (const row of rows) {
        if (!classState.rating.has(row.riderId)) classState.rating.set(row.riderId, entryRating(classState.rating));
        classState.points.set(
          row.riderId,
          (classState.points.get(row.riderId) ?? 0) + (row.status === 'DNF' || row.status === 'DSQ' ? 0 : pointsFor(row.pos)),
        );
        classState.starts.set(row.riderId, (classState.starts.get(row.riderId) ?? 0) + 1);
      }
      const deltas = eloMoto(
        classState.rating,
        rows.map((row) => row.riderId),
      );
      for (const [riderId, delta] of deltas) classState.rating.set(riderId, classState.rating.get(riderId) + delta);
    }
  }

  return motos;
}

/** Rank → calibrated probability, learned only from previous motos. */
export class RankModel {
  constructor(id, label, rankKey) {
    this.id = id;
    this.label = label;
    this.rankKey = rankKey;
    this.buckets = new Map();
    this.global = { win: 1, podium: 3, top10: 10, n: 20 };
  }

  predict(moto) {
    const ranks = moto.ranks[this.rankKey];
    const out = new Map();
    for (const row of moto.rows) {
      // A rider the feature cannot place (no qualifying time, no lap-1 time) is
      // given the field prior, not treated as last: "unknown" is not "slowest".
      if (!ranks || !ranks.has(row.riderId)) {
        out.set(row.riderId, fieldPrediction(moto.n));
        continue;
      }
      const rank = ranks.get(row.riderId) ?? moto.n;
      const bucket = Math.max(1, Math.min(BUCKET_MAX, Math.round(rank)));
      const counts = this.buckets.get(bucket) ?? { win: 0, podium: 0, top10: 0, n: 0 };
      const prior = this.global;
      const pWin = (counts.win + (SMOOTHING * prior.win) / prior.n) / (counts.n + SMOOTHING);
      const pPodium = (counts.podium + (SMOOTHING * prior.podium) / prior.n) / (counts.n + SMOOTHING);
      const pTop10 = (counts.top10 + (SMOOTHING * prior.top10) / prior.n) / (counts.n + SMOOTHING);
      out.set(row.riderId, { pWin, pPodium, pTop10, expectedPos: rank });
    }
    return out;
  }

  observe(moto) {
    const ranks = moto.ranks[this.rankKey];
    for (const row of moto.rows) {
      const rank = ranks?.get(row.riderId) ?? moto.n;
      const bucket = Math.max(1, Math.min(BUCKET_MAX, Math.round(rank)));
      const counts = this.buckets.get(bucket) ?? { win: 0, podium: 0, top10: 0, n: 0 };
      counts.n += 1;
      if (row.pos === 1) counts.win += 1;
      if (row.pos <= 3) counts.podium += 1;
      if (row.pos <= 10) counts.top10 += 1;
      this.buckets.set(bucket, counts);
      this.global.n += 1;
      if (row.pos === 1) this.global.win += 1;
      if (row.pos <= 3) this.global.podium += 1;
      if (row.pos <= 10) this.global.top10 += 1;
    }
  }
}

function fieldPrediction(n) {
  return { pWin: 1 / n, pPodium: Math.min(1, 3 / n), pTop10: Math.min(1, 10 / n), expectedPos: (n + 1) / 2 };
}

export const FieldModel = {
  id: 'field',
  label: 'Field average',
  predict: (moto) => new Map(moto.rows.map((row) => [row.riderId, fieldPrediction(moto.n)])),
  observe: () => {},
};

/** Every pre-registered model, in report order. */
export function defaultModels() {
  return [
    FieldModel,
    new RankModel('points', 'Points rank before the moto', 'points'),
    new RankModel('qualifying', 'Qualifying rank', 'qual'),
    new RankModel('lapOne', 'Lap-1 position (post-lap-1)', 'lap1'),
    new RankModel('rating', 'Rating rank', 'rating'),
  ];
}

/**
 * Run models over collected motos. Models are fitted in the same loop in which
 * they predict, and always observe only after predicting.
 */
export function evaluate(motos, models = defaultModels()) {
  const records = [];
  for (const moto of motos) {
    for (const model of models) {
      const predictions = model.predict(moto);
      for (const row of moto.rows) {
        const prediction = predictions.get(row.riderId) ?? fieldPrediction(moto.n);
        const clamped = {
          pWin: Math.max(0, Math.min(1, prediction.pWin)),
          pPodium: Math.max(0, Math.min(1, prediction.pPodium)),
          pTop10: Math.max(0, Math.min(1, prediction.pTop10)),
          expectedPos: prediction.expectedPos,
        };
        records.push({
          model: model.id,
          motoId: moto.motoId,
          season: moto.season,
          class: moto.class,
          predicted: clamped,
          actual: {
            pos: row.pos,
            win: row.pos === 1 ? 1 : 0,
            podium: row.pos <= 3 ? 1 : 0,
            top10: row.pos <= 10 ? 1 : 0,
          },
        });
      }
      model.observe(moto);
    }
  }
  return records;
}

const clip = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));

export function metricsFor(rows) {
  const motoIds = [...new Set(rows.map((row) => row.motoId))].sort();
  const mae =
    rows.length === 0
      ? null
      : rows.reduce((sum, row) => sum + Math.abs(row.predicted.expectedPos - row.actual.pos), 0) / rows.length;

  const brier = (key) => rows.reduce((sum, row) => sum + (row.predicted[`p${key}`] - row.actual[key.toLowerCase()]) ** 2, 0) / rows.length;
  const logLoss = (key) =>
    rows.reduce((sum, row) => {
      const p = clip(row.predicted[`p${key}`]);
      const y = row.actual[key.toLowerCase()];
      return sum - (y * Math.log(p) + (1 - y) * Math.log(1 - p));
    }, 0) / rows.length;

  const rhos = [];
  for (const motoId of motoIds) {
    const motoRows = rows.filter((row) => row.motoId === motoId);
    const rho = spearman(motoRows.map((row) => [row.predicted.expectedPos, row.actual.pos]));
    if (rho !== null) rhos.push(rho);
  }

  return {
    motos: motoIds.length,
    rows: rows.length,
    mae: round(mae, 3),
    medianRho: round(median(rhos), 3),
    strongShare: rhos.length === 0 ? null : round(rhos.filter((rho) => rho >= 0.5).length / rhos.length, 3),
    brier: { win: round(brier('Win'), 4), podium: round(brier('Podium'), 4), top10: round(brier('Top10'), 4) },
    logLoss: { win: round(logLoss('Win'), 4), podium: round(logLoss('Podium'), 4), top10: round(logLoss('Top10'), 4) },
  };
}

export function calibrationFor(rows, key) {
  const bins = Array.from({ length: 10 }, (_, index) => ({
    lo: index / 10,
    hi: (index + 1) / 10,
    n: 0,
    predictedSum: 0,
    observed: 0,
  }));
  for (const row of rows) {
    const p = row.predicted[`p${key}`];
    const index = p >= 1 ? 9 : Math.max(0, Math.min(9, Math.floor(p * 10)));
    const bin = bins[index];
    bin.n += 1;
    bin.predictedSum += p;
    bin.observed += row.actual[key.toLowerCase()];
  }
  return bins.map((bin) => ({
    lo: bin.lo,
    hi: bin.hi,
    n: bin.n,
    predicted: bin.n === 0 ? null : round(bin.predictedSum / bin.n, 4),
    observed: bin.n === 0 ? null : round(bin.observed / bin.n, 4),
    thin: bin.n > 0 && bin.n < 20,
  }));
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function brierOf(rows, key) {
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + (row.predicted[`p${key}`] - row.actual[key.toLowerCase()]) ** 2, 0) / rows.length;
}

/** Bootstrap 95% interval for Brier skill against a named reference model. */
export function bootstrapSkill(records, modelId, referenceId, key, { reps = 1000, seed = 20260101 } = {}) {
  const byMoto = new Map();
  for (const record of records) {
    if (record.model !== modelId && record.model !== referenceId) continue;
    if (!byMoto.has(record.motoId)) byMoto.set(record.motoId, []);
    byMoto.get(record.motoId).push(record);
  }
  const motoIds = [...byMoto.keys()].sort();
  if (motoIds.length < 2) return null;

  const random = seededRandom(seed);
  const values = [];
  for (let i = 0; i < reps; i += 1) {
    const sample = [];
    for (let j = 0; j < motoIds.length; j += 1) {
      sample.push(...byMoto.get(motoIds[Math.floor(random() * motoIds.length)]) ?? []);
    }
    const modelBrier = brierOf(sample.filter((row) => row.model === modelId), key);
    const referenceBrier = brierOf(sample.filter((row) => row.model === referenceId), key);
    if (!modelBrier || !referenceBrier) continue;
    values.push(1 - modelBrier / referenceBrier);
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { lo: round(percentile(sorted, 0.025), 4), hi: round(percentile(sorted, 0.975), 4), reps: values.length };
}

function groupMetrics(records, modelIds, filter = () => true) {
  const out = {};
  for (const modelId of modelIds) {
    const rows = records.filter((record) => record.model === modelId && filter(record));
    const metrics = metricsFor(rows);
    out[modelId] = metrics.motos >= MIN_GROUP ? metrics : { ...metrics, sufficient: false };
  }
  return out;
}

export function buildBacktests(events) {
  const motos = collectMotos(events);
  const models = defaultModels();
  const records = evaluate(motos, models);
  const modelIds = models.map((model) => model.id);

  const overall = groupMetrics(records, modelIds);
  for (const modelId of modelIds) {
    for (const key of ['Win', 'Podium', 'Top10']) {
      const field = overall[modelId]?.brier?.[key.toLowerCase()];
      const reference = overall.field?.brier?.[key.toLowerCase()];
      if (!Number.isFinite(field) || !Number.isFinite(reference) || reference === 0) continue;
      overall[modelId].skillVsField ??= {};
      overall[modelId].skillVsField[key.toLowerCase()] = round(1 - field / reference, 4);
    }
  }

  const seasons = [...new Set(motos.map((moto) => moto.season))].sort((a, b) => a - b);
  const classes = [...new Set(motos.map((moto) => moto.class))].sort();

  const bySeason = seasons.map((season) => ({
    season,
    models: groupMetrics(records, modelIds, (record) => record.season === season),
  }));
  const byClass = classes.map((className) => ({
    class: className,
    models: groupMetrics(records, modelIds, (record) => record.class === className),
  }));

  const calibration = {};
  for (const modelId of modelIds) {
    const rows = records.filter((record) => record.model === modelId);
    calibration[modelId] = {
      win: calibrationFor(rows, 'Win'),
      podium: calibrationFor(rows, 'Podium'),
      top10: calibrationFor(rows, 'Top10'),
    };
  }

  const intervals = {};
  for (const modelId of modelIds) {
    if (modelId === 'field') continue;
    intervals[modelId] = {
      winVsField: bootstrapSkill(records, modelId, 'field', 'Win'),
      podiumVsField: bootstrapSkill(records, modelId, 'field', 'Podium'),
      top10VsField: bootstrapSkill(records, modelId, 'field', 'Top10'),
    };
  }

  return {
    analysis: 'backtests',
    design: {
      registered: 'docs/backtests.md',
      validation: 'walk-forward by moto, chronological, per class; no feature sees the moto it predicts',
      minimumMotos: MIN_MOTOS,
      minimumGroup: MIN_GROUP,
      smoothing: SMOOTHING,
      bootstrapReps: 1000,
    },
    models: models.map((model) => ({ id: model.id, label: model.label })),
    coverage: {
      motos: motos.length,
      rows: records.filter((record) => record.model === 'field').length,
      seasons,
      classes,
      motosWithQualifying: motos.filter((moto) => moto.hasQual).length,
      motosWithLapOne: motos.filter((moto) => moto.hasLap).length,
    },
    overall,
    bySeason,
    byClass,
    calibration,
    intervals,
  };
}
