// 6.4 — what qualifying is worth.
//
// Qualifying and the motos are separate sessions, so the join is by rider within
// one event and class. The metric is positions gained: qualifying position minus
// mean finishing position across that class's motos at the same event. Positive
// means the rider raced better than they qualified.
//
// Only riders who appear in both sessions are counted. The qualifying sheet
// lists the whole entry list (71 at Pala against a 40-rider moto field), so a
// rider who did not make the motos has no race result to compare against, and
// counting them would drag every average toward "gained places".

import { cmp, mean, median, round, seasonOf, sortedEvents, sortedMotos, spearman } from './common.js';

export function buildQualifying(events) {
  const seasons = new Map();
  const riders = new Map();
  const raceRows = [];

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    if (!seasons.has(season)) {
      seasons.set(season, {
        season,
        events: 0,
        riders: 0,
        gains: [],
        rhos: [],
        moves: [],
        poleFinishes: [],
        poleWins: 0,
      });
    }
    const seasonRow = seasons.get(season);

    for (const qualifying of [...(event.qualifying ?? [])].sort((a, b) => cmp(a.class, b.class))) {
      const qualRows = (qualifying.rows ?? []).filter(
        (row) => Number.isFinite(row.bestMs) && Number.isInteger(row.pos),
      );
      if (qualRows.length === 0) continue;

      const motos = sortedMotos(event).filter((moto) => moto.class === qualifying.class);
      if (motos.length === 0) continue;

      const finishes = new Map();
      for (const moto of motos) {
        for (const row of moto.results ?? []) {
          if (!finishes.has(row.riderId)) finishes.set(row.riderId, []);
          finishes.get(row.riderId).push(row.pos);
        }
      }

      const pairs = [];
      const gains = [];
      const moves = [];
      for (const row of qualRows) {
        const positions = finishes.get(row.riderId);
        if (!positions || positions.length === 0) continue;
        const finish = mean(positions);
        pairs.push([row.pos, finish]);
        gains.push(row.pos - finish);
        moves.push(Math.abs(row.pos - finish));

        const key = `${season}:${row.riderId}`;
        if (!riders.has(key)) {
          riders.set(key, {
            riderId: row.riderId,
            name: row.name,
            season,
            events: 0,
            gains: [],
            qualPositions: [],
            finishes: [],
          });
        }
        const entry = riders.get(key);
        entry.events += 1;
        entry.gains.push(row.pos - finish);
        entry.qualPositions.push(row.pos);
        entry.finishes.push(finish);
      }

      if (pairs.length === 0) continue;
      const rho = spearman(pairs);

      // Re-ranking: if the gate were the grid, how far would the finishing order
      // move? The pole sitter's own finish is the sharpest single check.
      const pole = qualRows.find((row) => row.pos === 1) ?? null;
      const poleFinish = pole ? mean(finishes.get(pole.riderId) ?? []) : null;
      const poleWon = poleFinish === 1;

      seasonRow.events += 1;
      seasonRow.riders += gains.length;
      seasonRow.gains.push(...gains);
      seasonRow.moves.push(...moves);
      if (Number.isFinite(poleFinish)) {
        seasonRow.poleFinishes.push(poleFinish);
        if (poleWon) seasonRow.poleWins += 1;
      }
      if (rho !== null) seasonRow.rhos.push(rho);

      raceRows.push({
        season,
        eventId: event.event.id,
        name: event.event.name,
        round: event.event.round,
        class: qualifying.class,
        qualified: qualRows.length,
        raced: gains.length,
        medianGain: round(median(gains)),
        medianMove: round(median(moves)),
        poleFinish: round(poleFinish, 1),
        poleWon,
        rho: round(rho, 3),
      });
    }
  }

  const seasonSummaries = [...seasons.values()]
    .filter((row) => row.events > 0)
    .map((row) => ({
      season: row.season,
      events: row.events,
      riders: row.riders,
      medianGain: round(median(row.gains)),
      medianRho: round(median(row.rhos), 3),
      medianMove: round(median(row.moves)),
      poleWinRate: row.poleFinishes.length > 0 ? round(row.poleWins / row.poleFinishes.length, 3) : null,
      medianPoleFinish: round(median(row.poleFinishes), 1),
    }))
    .sort((a, b) => a.season - b.season);

  const leaderboard = [...riders.values()]
    .filter((row) => row.events >= 3)
    .map((row) => ({
      riderId: row.riderId,
      name: row.name,
      season: row.season,
      events: row.events,
      medianGain: round(median(row.gains)),
      medianQualifyingPos: round(median(row.qualPositions), 1),
      medianFinishPos: round(median(row.finishes), 1),
    }))
    .sort((a, b) => b.medianGain - a.medianGain || cmp(a.riderId, b.riderId));

  raceRows.sort((a, b) => cmp(a.season, b.season) || (a.round ?? 0) - (b.round ?? 0) || cmp(a.class, b.class));

  return {
    analysis: 'qualifying',
    method: {
      metric: 'qualifying position minus mean moto finishing position at the same event',
      join: 'rider within event and class; riders absent from the motos are not counted',
      correlation: 'Spearman rho between qualifying position and mean moto finish, per event and class',
      reRank: 'median absolute places moved between qualifying order and finishing order; the pole sitter counts as a win only when they win the moto',
      entrant: 'a rider-season needs 3 paired events to appear on the leaderboard',
    },
    coverage: {
      seasons: seasonSummaries.map((row) => row.season),
      events: seasonSummaries.reduce((sum, row) => sum + row.events, 0),
      riderEvents: seasonSummaries.reduce((sum, row) => sum + row.riders, 0),
      note: 'the qualifying sheet lists the whole entry list, not the moto field',
    },
    seasons: seasonSummaries,
    riders: leaderboard,
    races: raceRows,
  };
}
