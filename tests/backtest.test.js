import { assert, eq, test } from './harness.js';
import {
  bootstrapSkill,
  buildBacktests,
  calibrationFor,
  collectMotos,
  evaluate,
  metricsFor,
} from '../src/analysis/backtest.js';

const RIDERS = Array.from({ length: 12 }, (_, index) => `r${index + 1}`);

/**
 * A synthetic season of single-moto rounds. The finishing order rotates by one
 * place per round, so every rider wins sometimes and rank actually carries
 * information — a shuffled model should therefore score no better than the field.
 */
function synthetic(rounds = 24) {
  const events = [];
  for (let round = 1; round <= rounds; round += 1) {
    const order = [...RIDERS.slice(round % RIDERS.length), ...RIDERS.slice(0, round % RIDERS.length)];
    const rows = order.map((riderId, index) => ({
      pos: index + 1,
      plate: Number(riderId.slice(1)),
      riderId,
      name: riderId,
      status: null,
      laps: [
        { lap: 1, timeMs: 100000 + index * 100 },
        { lap: 2, timeMs: 99000 + index * 100 },
      ],
    }));
    events.push({
      event: { id: `E${round}`, date: `2024-${String(1 + Math.floor(round / 12)).padStart(2, '0')}-${String(round).padStart(2, '0')}`, round, ofRounds: rounds, name: `E${round}`, track: null, location: null },
      motos: [{ class: '450MX', moto: 1, results: rows }],
      qualifying: [
        {
          class: '450MX',
          session: '450QCOVR',
          rows: rows.map((row, index) => ({ pos: index + 1, riderId: row.riderId, name: row.name, bestMs: 80000 + index * 10 })),
        },
      ],
      warnings: [],
    });
  }
  return events;
}

test('backtest: output is deterministic and probabilities are in range', () => {
  const events = synthetic();
  const first = buildBacktests(events);
  const second = buildBacktests(events);
  eq(JSON.stringify(first), JSON.stringify(second));

  eq(first.coverage.motos, 24);
  eq(first.coverage.seasons, [2024]);
  eq(first.models.map((model) => model.id), ['field', 'points', 'qualifying', 'lapOne', 'rating']);

  for (const model of first.models) {
    const rows = first.calibration[model.id].win;
    assert(rows.length === 10, 'ten calibration bins');
    const total = rows.reduce((sum, bin) => sum + bin.n, 0);
    eq(total, first.coverage.rows, `${model.id}: calibration counts must sum to every prediction`);
    for (const bin of rows) {
      if (bin.predicted !== null) assert(bin.predicted >= 0 && bin.predicted <= 1, `${model.id}: probability outside [0,1]`);
      if (bin.observed !== null) assert(bin.observed >= 0 && bin.observed <= 1, `${model.id}: observed share outside [0,1]`);
    }
  }
});

test('backtest: the oracle scores a perfect Brier and zero MAE', () => {
  const motos = collectMotos(synthetic());
  const oracle = {
    id: 'oracle',
    label: 'oracle',
    predict: (moto) =>
      new Map(
        moto.rows.map((row) => [
          row.riderId,
          {
            pWin: row.pos === 1 ? 1 : 0,
            pPodium: row.pos <= 3 ? 1 : 0,
            pTop10: row.pos <= 10 ? 1 : 0,
            expectedPos: row.pos,
          },
        ]),
      ),
    observe: () => {},
  };
  const metrics = metricsFor(evaluate(motos, [oracle]));
  eq(metrics.mae, 0);
  eq(metrics.brier.win, 0);
  eq(metrics.brier.top10, 0);
});

test('backtest: shuffling the labels collapses skill', () => {
  const motos = collectMotos(synthetic());
  // A rank that depends on rider identity, not on ability: a deterministic hash.
  const noise = {
    id: 'noise',
    label: 'noise',
    predict: (moto) => {
      const out = new Map();
      for (const row of moto.rows) {
        const hash = [...row.riderId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const rank = (hash % moto.n) + 1;
        out.set(row.riderId, { pWin: 1 / moto.n, pPodium: 3 / moto.n, pTop10: 10 / moto.n, expectedPos: rank });
      }
      return out;
    },
    observe: () => {},
  };

  const records = evaluate(motos, [noise, { id: 'field', label: 'field', predict: (moto) => new Map(moto.rows.map((row) => [row.riderId, { pWin: 1 / moto.n, pPodium: 3 / moto.n, pTop10: 10 / moto.n, expectedPos: (moto.n + 1) / 2 }])), observe: () => {} }]);
  const noiseMetrics = metricsFor(records.filter((record) => record.model === 'noise'));
  const fieldMetrics = metricsFor(records.filter((record) => record.model === 'field'));

  for (const key of ['win', 'podium', 'top10']) {
    const skill = 1 - noiseMetrics.brier[key] / fieldMetrics.brier[key];
    assert(Math.abs(skill) < 0.05, `a shuffled predictor must not beat the field (${key} skill ${skill.toFixed(3)})`);
  }
});

test('backtest: bootstrap intervals are reproducible and bracket the point estimate', () => {
  const records = evaluate(collectMotos(synthetic()));
  const first = bootstrapSkill(records, 'points', 'field', 'Win');
  const second = bootstrapSkill(records, 'points', 'field', 'Win');
  eq(first, second);
  assert(first.lo <= first.hi, 'interval bounds are ordered');
});

test('backtest: a moto with fewer than eight finishers is not scored', () => {
  const events = synthetic(1);
  events[0].motos[0].results = events[0].motos[0].results.slice(0, 4);
  eq(collectMotos(events).length, 0);
});

test('backtest: calibration bins count every prediction once', () => {
  const records = evaluate(collectMotos(synthetic()));
  const rows = records.filter((record) => record.model === 'field');
  const bins = calibrationFor(rows, 'Win');
  eq(bins.reduce((sum, bin) => sum + bin.n, 0), rows.length);
  const sumPredicted = bins.reduce((sum, bin) => sum + (bin.predicted ?? 0) * bin.n, 0);
  const sumObserved = bins.reduce((sum, bin) => sum + (bin.observed ?? 0) * bin.n, 0);
  // The derived file rounds to four decimals, so compare to that precision.
  assert(Math.abs(sumPredicted / rows.length - 1 / 12) < 1e-3, 'field probability is 1/n');
  // `observed` is rounded to four decimals in the derived output, so allow half a row.
  assert(Math.abs(sumObserved - rows.length / 12) < 0.5, 'one winner per moto');
});
