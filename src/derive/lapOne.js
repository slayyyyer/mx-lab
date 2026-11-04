// 6.3 — what lap 1 is worth.
//
// The question: does the opening lap already tell you the finishing order? For
// each moto, rank the riders who have a lap-1 time by that time, rank them by
// finish, and take Spearman's rho. Then look at how that behaves by season.
//
// Lap 1 is often absent in 2020–2024 — the sheets print `--.---` for part of the
// field — so coverage is reported next to every correlation. A season with 40%
// lap-1 coverage is answering about the riders who got a clean start, not the
// whole field, and the page says so.

import { cmp, round, seasonOf, sortedEvents, sortedMotos, spearman } from './common.js';

const MIN_RIDERS = 8;

export function buildLapOne(events) {
  const seasons = new Map();
  const raceRows = [];
  let motosTotal = 0;
  let motosMeasured = 0;
  let rowsTotal = 0;
  let rowsWithLapOne = 0;

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    if (!seasons.has(season)) {
      seasons.set(season, { season, motos: 0, measured: 0, rhos: [], rows: 0, withLapOne: 0 });
    }
    const seasonRow = seasons.get(season);

    for (const moto of sortedMotos(event)) {
      motosTotal += 1;
      seasonRow.motos += 1;

      const pairs = [];
      for (const row of moto.results ?? []) {
        rowsTotal += 1;
        seasonRow.rows += 1;
        const lapOne = (row.laps ?? []).find((lap) => lap.lap === 1);
        if (!Number.isFinite(lapOne?.timeMs)) continue;
        rowsWithLapOne += 1;
        seasonRow.withLapOne += 1;
        pairs.push([lapOne.timeMs, row.pos]);
      }

      const rho = pairs.length >= MIN_RIDERS ? spearman(pairs) : null;
      if (rho !== null) {
        motosMeasured += 1;
        seasonRow.measured += 1;
        seasonRow.rhos.push(rho);
      }
    }

    raceRows.push({
      season,
      eventId: event.event.id,
      name: event.event.name,
      round: event.event.round,
      motos: sortedMotos(event).map((moto) => {
        const pairs = [];
        for (const row of moto.results ?? []) {
          const lapOne = (row.laps ?? []).find((lap) => lap.lap === 1);
          if (Number.isFinite(lapOne?.timeMs)) pairs.push([lapOne.timeMs, row.pos]);
        }
        const rho = pairs.length >= MIN_RIDERS ? spearman(pairs) : null;
        return {
          class: moto.class,
          moto: moto.moto,
          ridersWithLapOne: pairs.length,
          riders: (moto.results ?? []).length,
          rho: round(rho, 3),
        };
      }),
    });
  }

  const series = [...seasons.values()]
    .filter((row) => row.measured > 0)
    .map((row) => ({
      season: row.season,
      motos: row.motos,
      motosMeasured: row.measured,
      medianRho: round(medianOf(row.rhos), 3),
      strongShare: round(row.rhos.filter((rho) => rho >= 0.5).length / row.rhos.length, 3),
      lapOneCoverage: round(row.withLapOne / row.rows, 3),
    }))
    .sort((a, b) => a.season - b.season);

  raceRows.sort((a, b) => cmp(a.season, b.season) || (a.round ?? 0) - (b.round ?? 0));

  return {
    analysis: 'lap-one',
    method: {
      metric: 'Spearman rank correlation between lap-1 time and finishing position, per moto',
      minimumRiders: MIN_RIDERS,
      reading: 'a rho near 1 means the opening lap already ordered the moto; near 0 means it did not',
    },
    coverage: {
      seasons: series.map((row) => row.season),
      motos: motosTotal,
      motosMeasured,
      rows: rowsTotal,
      rowsWithLapOne,
      lapOneCoverage: round(rowsWithLapOne / rowsTotal, 3),
      note: 'lap 1 is printed `--.---` for part of the 2020–2024 field, so coverage is reported per season',
    },
    seasons: series,
    races: raceRows,
  };
}

function medianOf(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
