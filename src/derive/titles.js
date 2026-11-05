// 6.5 — the championship, computed.
//
// The dataset records finishing positions, not points, so standings are scored
// from the standard moto points table (25-22-20-18 then one fewer per place to
// 20th). That is a derived number and the page labels it as one.
//
// Both motos of every round score. A DNF scores nothing and still counts as a
// moto started — dropping the row would quietly raise that rider's average
// finish. Ties are broken the way a standings sheet does it: more wins, then a
// better best finish, then rider id so the order is stable.

import { POINTS_TABLE, cmp, isChampionshipClass, pointsFor, round, seasonOf, sortedEvents, sortedMotos } from './common.js';

const SCORING_POSITIONS = POINTS_TABLE.length;

/**
 * AMA countback: most wins, then most second places, then third, and so on.
 * Used where two riders finish level on points.
 */
export function countback(a, b) {
  const length = Math.max(a.counts?.length ?? 0, b.counts?.length ?? 0);
  for (let i = 0; i < length; i += 1) {
    const diff = (b.counts?.[i] ?? 0) - (a.counts?.[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function buildTitles(events) {
  const seasons = new Map();

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    if (!seasons.has(season)) seasons.set(season, { season, ofRounds: event.event.ofRounds ?? null, classes: new Map() });
    const seasonState = seasons.get(season);
    if (seasonState.ofRounds === null && event.event.ofRounds) seasonState.ofRounds = event.event.ofRounds;

    const round = event.event.round ?? null;
    for (const moto of sortedMotos(event)) {
      if (!isChampionshipClass(moto.class)) continue;
      if (!seasonState.classes.has(moto.class)) {
        seasonState.classes.set(moto.class, {
          class: moto.class,
          rounds: new Set(),
          riders: new Map(),
          roundPoints: new Map(),
          roundLastPos: new Map(),
        });
      }
      const state = seasonState.classes.get(moto.class);
      if (round !== null) state.rounds.add(round);

      for (const row of moto.results ?? []) {
        // Triple Crown overall sheets print the official award (26 for a win);
        // every other sheet leaves it to the derived table.
        const scored = Number.isFinite(row.points)
          ? row.points
          : row.status === 'DNF'
            ? 0
            : pointsFor(row.pos);
        if (!state.riders.has(row.riderId)) {
          state.riders.set(row.riderId, {
            riderId: row.riderId,
            name: row.name,
            points: 0,
            motos: 0,
            counts: [],
            wins: 0,
            podiums: 0,
            top10: 0,
            best: null,
            dnf: 0,
            finishSum: 0,
            finishCount: 0,
          });
        }
        const rider = state.riders.get(row.riderId);
        rider.points += scored;
        rider.motos += 1;
        if (row.status === 'DNF') {
          rider.dnf += 1;
        } else {
          rider.finishSum += row.pos;
          rider.finishCount += 1;
          rider.counts[row.pos - 1] = (rider.counts[row.pos - 1] ?? 0) + 1;
          if (row.pos === 1) rider.wins += 1;
        }
        if (row.status !== 'DNF' && row.pos <= 3) rider.podiums += 1;
        if (row.status !== 'DNF' && row.pos <= 10) rider.top10 += 1;
        rider.best = rider.best === null ? row.pos : Math.min(rider.best, row.pos);

        if (round !== null) {
          state.roundPoints.set(
            round,
            (state.roundPoints.get(round) ?? new Map()).set(
              row.riderId,
              ((state.roundPoints.get(round)?.get(row.riderId) ?? 0) + scored),
            ),
          );
          state.roundLastPos.set(round, (state.roundLastPos.get(round) ?? new Map()).set(row.riderId, row.pos));
        }
      }
    }
  }

  const out = [];
  for (const [season, seasonState] of [...seasons.entries()].sort((a, b) => a[0] - b[0])) {
    const classes = {};
    for (const [className, state] of [...seasonState.classes.entries()].sort((a, b) => cmp(a[0], b[0]))) {
      const rounds = [...state.rounds].sort((a, b) => a - b);
      const standings = [...state.riders.values()].sort(
        (a, b) => b.points - a.points || countback(a, b) || cmp(a.riderId, b.riderId),
      );

      // Round winners: the best two-moto total in that class at that round.
      const roundWinners = rounds
        .map((round) => {
          const points = state.roundPoints.get(round);
          if (!points) return null;
          const [riderId, scored] = [...points.entries()].sort(
            (a, b) =>
              b[1] - a[1] ||
              (state.roundLastPos.get(round)?.get(a[0]) ?? 999) - (state.roundLastPos.get(round)?.get(b[0]) ?? 999) ||
              cmp(a[0], b[0]),
          )[0];
          return { round, riderId, points: scored };
        })
        .filter(Boolean);

      // Cumulative points by round, for the top eight. Every rider starts at 0;
      // a round they missed carries the previous total forward.
      const leaders = standings.slice(0, 8);
      const trajectory = leaders.map((rider) => {
        let total = 0;
        const points = rounds.map((round) => {
          total += state.roundPoints.get(round)?.get(rider.riderId) ?? 0;
          return total;
        });
        return { riderId: rider.riderId, name: rider.name, points };
      });

      const champion = standings[0] ?? null;
      // What one round of this class can pay: 50 for a two-moto Motocross round,
      // 25 for a single Supercross main, 26 at a Triple Crown overall.
      let maxRoundPoints = 0;
      for (const points of state.roundPoints.values()) {
        for (const scored of points.values()) maxRoundPoints = Math.max(maxRoundPoints, scored);
      }

      const winsThrough = (riderId, upto) =>
        rounds.filter((round) => round <= upto && state.roundLastPos.get(round)?.get(riderId) === 1).length;

      let clinchedRound = null;
      let clinchProof = null;
      if (champion) {
        for (const [roundIndex, round] of rounds.entries()) {
          const cumulative = new Map();
          for (const rider of standings) {
            let total = 0;
            for (const r of rounds) {
              if (r > round) break;
              total += state.roundPoints.get(r)?.get(rider.riderId) ?? 0;
            }
            cumulative.set(rider.riderId, total);
          }
          const ordered = [...cumulative.entries()]
            .map(([riderId, total]) => ({ riderId, total, rider: state.riders.get(riderId) }))
            .sort(
              (a, b) => b.total - a.total || countback(a.rider, b.rider) || cmp(a.riderId, b.riderId),
            );
          if (ordered.length < 2) continue;

          // Rounds still to run for this class, not for the season: a Motocross
          // class has 11 rounds in a year whose Supercross calendar runs 17, and
          // a 250SX coast only races its own share.
          const remaining = rounds.length - roundIndex - 1;
          const available = remaining * maxRoundPoints;
          const [leader, rival] = ordered;
          const gap = leader.total - rival.total;
          // A rival can only draw level by taking every remaining point while the
          // leader takes none, so an exact tie is safe only if the countback holds.
          const tieBreakHolds =
            winsThrough(leader.riderId, round) > winsThrough(rival.riderId, round) + remaining;

          if (gap > available || (gap === available && tieBreakHolds)) {
            clinchedRound = round;
            clinchProof = { gap, available, rivalId: rival.riderId, tieBreakHolds };
            break;
          }
        }
      }

      classes[className] = {
        rounds: rounds.length,
        scoringPositions: SCORING_POSITIONS,
        roundWinners,
        champion: champion
          ? {
              riderId: champion.riderId,
              name: champion.name,
              points: champion.points,
              clinchedRound,
              clinchProof,
            }
          : null,
        standings: standings.map((rider) => ({
          riderId: rider.riderId,
          name: rider.name,
          points: rider.points,
          motos: rider.motos,
          wins: rider.wins,
          podiums: rider.podiums,
          top10: rider.top10,
          best: rider.best,
          dnf: rider.dnf,
          averageFinish: rider.finishCount > 0 ? round(rider.finishSum / rider.finishCount, 1) : null,
        })),
        trajectory,
      };
    }
    out.push({ season, ofRounds: seasonState.ofRounds, classes });
  }

  return {
    analysis: 'titles',
    method: {
      pointsTable: POINTS_TABLE,
      scoring: 'both motos score; a DNF scores 0 and still counts as a moto started',
      tiebreak: 'points, then countback (most wins, then most seconds, and so on), then rider id',
      clinch:
        'the leader clinches when no rival can reach their total, counting the points the class can still score per round; a rival who can only tie must also beat the countback',
      computed: true,
    },
    coverage: {
      seasons: out.map((row) => row.season),
      note: 'points are computed from finishing positions; the sources do not print them',
    },
    seasons: out,
  };
}
