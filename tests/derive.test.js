import { readdir, readFile } from 'node:fs/promises';

import { assert, eq, test } from './harness.js';
import { POINTS_TABLE, median, pointsFor, ranks, round, spearman } from '../src/derive/common.js';
import { buildFade, riderFade } from '../src/derive/fade.js';
import { buildLapChart } from '../src/derive/lapChart.js';
import { buildLapOne } from '../src/derive/lapOne.js';
import { buildQualifying } from '../src/derive/qualifying.js';
import { buildRatings, eloMoto } from '../src/derive/ratings.js';
import { buildTitles } from '../src/derive/titles.js';
import { deriveAll } from '../src/derive/index.js';

const event = ({ id, date, round, ofRounds, motos, qualifying = [] }) => ({
  event: { id, date, round, ofRounds, name: id, track: null, location: null },
  motos,
  qualifying,
  warnings: [],
});

const row = ({ pos, riderId, name = riderId, laps = [], status = null }) => ({
  pos,
  plate: pos,
  riderId,
  name,
  status,
  laps,
});

const laps = (times) => times.map((timeMs, index) => ({ lap: index + 1, timeMs }));

test('derive: the points table is 25 down to 1 over twenty places', () => {
  eq(POINTS_TABLE.length, 20);
  eq(pointsFor(1), 25);
  eq(pointsFor(2), 22);
  eq(pointsFor(3), 20);
  eq(pointsFor(4), 18);
  eq(pointsFor(20), 1);
  eq(pointsFor(21), 0);
  eq(pointsFor(0), 0);
  eq(pointsFor(null), 0);
});

test('derive: median, rounding and -0', () => {
  eq(median([3, 1, 2]), 2);
  eq(median([4, 1, 3, 2]), 2.5);
  eq(median([]), null);
  eq(round(1.0051), 1.01);
  eq(Object.is(round(-0.0001), -0), false);
});

test('derive: spearman is 1 for the same order, -1 reversed, and null without variation', () => {
  eq(spearman([[1, 1], [2, 2], [3, 3]]), 1);
  eq(spearman([[1, 3], [2, 2], [3, 1]]), -1);
  eq(spearman([[5, 1], [5, 2], [5, 3]]), null);
  // Ties share the rank they span.
  eq(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test('derive: fade compares medians of the two halves and drops stoppages', () => {
  const steady = riderFade({ laps: laps([null, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000]) });
  // Ten timed laps (2..11): five at 60s then five at 63s, with one 120s stoppage dropped.
  const dropped = riderFade({ laps: laps([null, 60000, 60000, 60000, 60000, 60000, 63000, 120000, 63000, 63000, 63000]) });
  eq(steady.fadePct, 0); // eight timed laps, flat: median 60s on both sides of the split
  eq(dropped.fadePct, 5);
  eq(riderFade({ laps: laps([null, 60000, 61000]) }), null); // too few laps
});

test('derive: the lap chart uses only seasons that print per-lap positions', () => {
  const pdf = event({
    id: 'M2405',
    date: '2024-05-25',
    round: 1,
    ofRounds: 11,
    motos: [{ class: '450MX', moto: 1, results: [row({ pos: 1, riderId: 'a', laps: [{ lap: 1, timeMs: 1000 }] })] }],
  });
  const lt = event({
    id: 'LT2501',
    date: '2025-05-24',
    round: 1,
    ofRounds: 11,
    motos: [
      {
        class: '250MX',
        moto: 1,
        results: [
          row({ pos: 1, riderId: 'a', laps: [{ lap: 1, position: 2, timeMs: 1000 }, { lap: 2, position: 1, timeMs: 900 }] }),
          row({ pos: 2, riderId: 'b', laps: [{ lap: 1, position: 1, timeMs: 1000 }, { lap: 2, position: 2, timeMs: 910 }] }),
        ],
      },
    ],
  });

  const chart = buildLapChart([pdf, lt]);
  eq(chart.coverage.events, 1);
  eq(chart.coverage.motos, 1);
  eq(chart.coverage.seasons, [2025, 2026]);
  eq(chart.races[0].motos[0].riders[0].positions, [2, 1]);});

test('derive: lap 1 correlates with the finish when it is printed', () => {
  const results = [];
  for (let i = 1; i <= 10; i += 1) {
    results.push(row({ pos: i, riderId: `r${i}`, laps: [{ lap: 1, timeMs: 100000 + i * 100 }, { lap: 2, timeMs: 99000 }] }));
  }
  const built = buildLapOne([
    event({ id: 'LT2501', date: '2025-05-24', round: 1, ofRounds: 11, motos: [{ class: '250MX', moto: 1, results }] }),
  ]);
  eq(built.seasons.length, 1);
  eq(built.seasons[0].medianRho, 1);
  eq(built.seasons[0].lapOneCoverage, 1);
});

test('derive: qualifying gain is qualifying position minus finishing position', () => {
  const round = (id, date, number) =>
    event({
      id,
      date,
      round: number,
      ofRounds: 3,
      motos: [
        {
          class: '450MX',
          moto: 1,
          results: [row({ pos: 1, riderId: 'a' }), row({ pos: 2, riderId: 'b' }), row({ pos: 3, riderId: 'c' })],
        },
      ],
      qualifying: [
        {
          class: '450MX',
          session: '450QCOVR',
          rows: [
            { pos: 1, riderId: 'b', name: 'b', bestMs: 80000 },
            { pos: 2, riderId: 'c', name: 'c', bestMs: 80100 },
            { pos: 3, riderId: 'a', name: 'a', bestMs: 80200 },
            { pos: 4, riderId: 'd', name: 'd', bestMs: 80300 },
          ],
        },
      ],
    });
  const built = buildQualifying([
    round('E1', '2024-05-25', 1),
    round('E2', '2024-06-01', 2),
    round('E3', '2024-06-08', 3),
  ]);
  const gains = Object.fromEntries(built.riders.map((rider) => [rider.riderId, rider.medianGain]));
  // a: qualified 3rd, finished 1st -> +2. b: 1st -> 2nd -> -1. c: 2nd -> 3rd -> -1. d did not race.
  eq(gains.a, 2);
  eq(gains.b, -1);
  eq(gains.c, -1);
  eq(built.riders.length, 3);
});

test('derive: standings score both motos, DNF scores nothing, and a clinch needs a real gap', () => {
  const motos = (round) => [
    {
      class: '450MX',
      moto: 1,
      results: [row({ pos: 1, riderId: 'a', name: 'A' }), row({ pos: 2, riderId: 'b', name: 'B' })],
    },
    {
      class: '450MX',
      moto: 2,
      results: [row({ pos: 1, riderId: 'a', name: 'A' }), row({ pos: 2, riderId: 'b', name: 'B', status: 'DNF' })],
    },
  ];
  const built = buildTitles([
    event({ id: 'E1', date: '2024-05-25', round: 1, ofRounds: 2, motos: motos(1) }),
    event({ id: 'E2', date: '2024-06-01', round: 2, ofRounds: 2, motos: motos(2) }),
  ]);
  const table = built.seasons[0].classes['450MX'];
  const a = table.standings.find((rider) => rider.riderId === 'a');
  const b = table.standings.find((rider) => rider.riderId === 'b');
  eq(a.points, 100);
  eq(b.points, 44);
  eq(a.wins, 4);
  eq(b.dnf, 2);
  eq(table.champion.riderId, 'a');
  // 56 points clear with 0 points left after round 2.
  eq(table.champion.clinchedRound, 2);
  eq(table.trajectory[0].points, [50, 100]);
});

test('derive: elo compares every finisher, sums to roughly zero, and rewards the better result', () => {
  const ratings = new Map([['a', 1500], ['b', 1500], ['c', 1500]]);
  const deltas = eloMoto(ratings, ['a', 'b', 'c']);
  assert(deltas.get('a') > 0, 'winner gained');
  assert(deltas.get('c') < 0, 'last lost');
  const total = [...deltas.values()].reduce((sum, value) => sum + value, 0);
  assert(Math.abs(total) < 1e-9, `ratings drifted: ${total}`);
});

test('derive: ratings carry a rider across seasons and reward beating a stronger field', () => {
  const built = buildRatings([
    event({
      id: 'E1',
      date: '2024-05-25',
      round: 1,
      ofRounds: 2,
      motos: [
        { class: '450MX', moto: 1, results: [row({ pos: 1, riderId: 'a' }), row({ pos: 2, riderId: 'b' })] },
        { class: '450MX', moto: 2, results: [row({ pos: 1, riderId: 'b' }), row({ pos: 2, riderId: 'a' })] },
      ],
    }),
  ]);
  const seasons = built.classes['450MX'].seasons;
  eq(seasons.length, 1);
  eq(seasons[0].riders.length, 2);
  const a = seasons[0].riders.find((rider) => rider.riderId === 'a');
  eq(a.start, 1500);
  // One win and one loss against the same rider leaves them close to where they started.
  assert(Math.abs(a.rating - 1500) < 5, `rating drifted too far: ${a.rating}`);
  eq(a.delta, round(a.rating - a.start));
});

test('derive: the committed dataset produces all six analyses deterministically', async () => {
  const dir = new URL('../data/events/', import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort();
  const events = [];
  for (const file of files) events.push(JSON.parse(await readFile(new URL(file, dir), 'utf8')));

  const first = deriveAll(events);
  const second = deriveAll(events);
  eq(JSON.stringify(first), JSON.stringify(second));

  // 77 Motocross events from 2020–2026 plus 84 Supercross events from 2020–2024.
  eq(first.meta.dataset.events, 161);
  eq(first.meta.dataset.rows, 15938);
  eq(first.meta.dataset.laps, 227758);
  eq(first.meta.seasons.length, 7);

  eq(first.lapChart.coverage.seasons, [2025, 2026]);
  eq(first.lapChart.coverage.motos, 88);
  // The chart keeps the top twenty finishers, so it counts fewer laps than the 51,432
  // the dataset holds for 2025-2026.
  assert(first.lapChart.coverage.lapsWithPosition > 25000, 'lap chart is thinner than the top-20 field');

  eq(first.fade.coverage.seasons, [2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert(first.fade.coverage.riderMotos > 8000, `fade measured only ${first.fade.coverage.riderMotos} motos`);
  assert(first.fade.seasons.every((row) => row.medianFadePct > 0), 'the field should slow down');

  // 2020 prints `--.---` for lap 1 across the entire field, so lap-1 analysis starts in 2021.
  eq(first.lapOne.seasons.map((row) => row.season), [2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert(first.lapOne.coverage.lapOneCoverage < 1, '2020-2024 is missing lap 1 for part of the field');
  // 2020 Motocross prints `--.---` for lap 1 across the entire field; the 2020
  // Supercross rounds do print it, so the season is no longer empty.
  const mx2020 = first.lapOne.races.filter((race) => race.season === 2020 && race.eventId.startsWith('M'));
  assert(mx2020.length > 0, 'the 2020 Motocross races should still be listed');
  assert(
    mx2020.every((race) => race.motos.every((moto) => moto.ridersWithLapOne === 0)),
    '2020 Motocross should have no lap-1 times at all',
  );
  const sx2020 = first.lapOne.races.filter((race) => race.season === 2020 && race.eventId.startsWith('S'));
  assert(
    sx2020.some((race) => race.motos.some((moto) => moto.ridersWithLapOne > 0)),
    '2020 Supercross should print lap-1 times',
  );
  assert(
    first.lapOne.seasons.every((row) => row.lapOneCoverage > 0 && row.lapOneCoverage <= 1),
    'lap-1 coverage must be a share',
  );

  eq(first.qualifying.seasons.length, 7);
  assert(first.qualifying.riders.length > 100, 'qualifying leaderboard is empty');

  eq(first.titles.seasons.length, 7);
  // Supercross stops at 2024 in the archive; its 250 title is scored per coast.
  const MX_CLASSES = ['250MX', '450MX'];
  const SX_CLASSES = ['250SX East', '250SX West', '450SX'];
  for (const season of first.titles.seasons) {
    const classes = season.season <= 2024 ? [...MX_CLASSES, ...SX_CLASSES].sort() : MX_CLASSES;
    eq(Object.keys(season.classes).sort(), classes);
    for (const className of classes) {
      const table = season.classes[className];
      assert(table.champion, `${season.season} ${className} has no champion`);
      eq(table.standings[0].riderId, table.champion.riderId);
      const points = table.standings.map((rider) => rider.points);
      assert(
        points.every((value, index) => index === 0 || points[index - 1] >= value),
        `${season.season} ${className} standings are not in points order`,
      );
    }
  }

  eq(Object.keys(first.ratings.classes).sort(), ['250MX', '250SX East', '250SX West', '450MX', '450SX']);
  assert(first.ratings.classes['450MX'].allTime.length > 10, 'ratings all-time table is thin');
  for (const className of ['250MX', '250SX East', '250SX West', '450MX', '450SX']) {
    for (const season of first.ratings.classes[className].seasons) {
      assert(season.riders.length > 10, `${className} ${season.season} has no rated field`);
      assert(
        season.trajectory.every((line) => line.ratings.every((value) => value === null || Number.isFinite(value))),
        'trajectory must not contain NaN',
      );
    }
  }
});
