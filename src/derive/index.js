// The analysis layer: every derived file is built from the committed dataset and
// nothing else. `deriveAll` is pure — the CLI reads the event files, hands them
// here, and writes the result — so the tests run the same code the site shows.

import { buildBacktests } from '../analysis/backtest.js';
import { buildEntities } from './entities.js';
import { buildFade } from './fade.js';
import { buildLapChart } from './lapChart.js';
import { buildLapOne } from './lapOne.js';
import { buildQualifying } from './qualifying.js';
import { buildRatings } from './ratings.js';
import { buildTitles } from './titles.js';
import { seasonOf, sortedEvents, sortedMotos } from './common.js';

export function buildMeta(events) {
  const seasons = new Map();
  let rows = 0;
  let laps = 0;
  let warnings = 0;
  let qualifying = 0;

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    const source = event.event.id.startsWith('LT')
      ? 'results.promotocross.com'
      : event.event.id.startsWith('SL')
        ? 'results.supercrosslive.com'
        : 'americanmotocrossresults.com';
    if (!seasons.has(season)) {
      seasons.set(season, {
        season,
        sources: new Set(),
        events: 0,
        motos: 0,
        rows: 0,
        laps: 0,
        qualifying: 0,
        warnings: 0,
      });
    }
    const row = seasons.get(season);
    row.sources.add(source);
    row.events += 1;
    row.warnings += (event.warnings ?? []).length;
    row.qualifying += (event.qualifying ?? []).length;
    qualifying += (event.qualifying ?? []).length;
    warnings += (event.warnings ?? []).length;

    for (const moto of sortedMotos(event)) {
      row.motos += 1;
      for (const result of moto.results ?? []) {
        row.rows += 1;
        rows += 1;
        const count = (result.laps ?? []).length;
        row.laps += count;
        laps += count;
      }
    }
  }

  const list = [...seasons.values()]
    .map(({ sources, ...season }) => ({ ...season, source: [...sources].sort().join(' + ') }))
    .sort((a, b) => a.season - b.season);
  return {
    analysis: 'meta',
    dataset: {
      events: list.reduce((sum, row) => sum + row.events, 0),
      motos: list.reduce((sum, row) => sum + row.motos, 0),
      rows,
      laps,
      qualifyingSheets: qualifying,
      warnings,
      seasons: list.length,
    },
    seasons: list,
  };
}

export function deriveAll(events) {
  return {
    meta: buildMeta(events),
    lapChart: buildLapChart(events),
    fade: buildFade(events),
    lapOne: buildLapOne(events),
    qualifying: buildQualifying(events),
    titles: buildTitles(events),
    ratings: buildRatings(events),
    backtests: buildBacktests(events),
    entities: buildEntities(events),
  };
}

/** File name and top-level key for each derived analysis. */
export const DERIVED_FILES = [
  ['meta', 'meta.json'],
  ['lapChart', 'lap-chart.json'],
  ['fade', 'fade.json'],
  ['lapOne', 'lap-one.json'],
  ['qualifying', 'qualifying.json'],
  ['titles', 'titles.json'],
  ['ratings', 'ratings.json'],
  ['backtests', 'backtests.json'],
  ['entities', 'entities.json'],
];
