// 6.6 — ratings.
//
// A rating that only counts wins is a standings table with extra steps, so this
// is Elo over every finisher at once: within a moto every rider is compared with
// every other, and each result moves both ratings. A win over a strong field is
// therefore worth more than a win over a weak one, which is the whole point —
// it lets riders from different seasons be compared without pretending the
// fields were equal.
//
// Details that matter for reproducibility:
//   - one continuous rating per class across all seven seasons, so a rider keeps
//     their rating when they change numbers;
//   - a new rider enters at the class median, not at 1500, so the scale does not
//     drift as the field grows;
//   - from a snapshot taken before the moto, all deltas are computed and then
//     applied together. Processing pairs one at a time would make the result
//     depend on pair order inside a moto.

import { cmp, isChampionshipClass, median, round, seasonOf, sortedEvents, sortedMotos } from './common.js';

const K = 32;
const START = 1500;
const MIN_MOTOS_LEADERBOARD = 10;
const TRAJECTORY_RIDERS = 5;

export function eloMoto(ratings, order, k = K) {
  const n = order.length;
  if (n < 2) return new Map();
  const effective = k / (n - 1);
  const deltas = new Map(order.map((riderId) => [riderId, 0]));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const winner = order[i];
      const loser = order[j];
      const expected = 1 / (1 + 10 ** ((ratings.get(loser) - ratings.get(winner)) / 400));
      deltas.set(winner, deltas.get(winner) + effective * (1 - expected));
      deltas.set(loser, deltas.get(loser) - effective * (1 - expected));
    }
  }
  return deltas;
}

export function buildRatings(events) {
  const classes = new Map();

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    for (const moto of sortedMotos(event)) {
      if (!isChampionshipClass(moto.class)) continue;
      if (!classes.has(moto.class)) {
        classes.set(moto.class, {
          class: moto.class,
          ratings: new Map(),
          names: new Map(),
          seasons: new Map(),
          rounds: [],
          lastRoundRatings: null,
        });
      }
      const state = classes.get(moto.class);
      const rows = [...(moto.results ?? [])].filter((row) => Number.isInteger(row.pos)).sort((a, b) => a.pos - b.pos);
      if (rows.length < 2) continue;

      const values = [...state.ratings.values()];
      const entry = values.length > 0 ? median(values) : START;
      for (const row of rows) {
        if (!state.ratings.has(row.riderId)) {
          state.ratings.set(row.riderId, entry);
          state.names.set(row.riderId, row.name);
        } else {
          state.names.set(row.riderId, row.name);
        }
      }

      const seasonState = getSeason(state, season);
      for (const row of rows) {
        const stat = getRiderSeason(seasonState, row.riderId, row.name, state.ratings.get(row.riderId));
        stat.motos += 1;
      }

      const order = rows.map((row) => row.riderId);
      const deltas = eloMoto(state.ratings, order);
      for (const [riderId, delta] of deltas) {
        state.ratings.set(riderId, state.ratings.get(riderId) + delta);
      }
      for (const row of rows) {
        const stat = getRiderSeason(seasonState, row.riderId, row.name, state.ratings.get(row.riderId));
        stat.end = state.ratings.get(row.riderId);
        stat.peak = stat.peak === null ? stat.end : Math.max(stat.peak, stat.end);
      }

      state.lastRoundRatings = new Map(state.ratings);
      const existing = state.rounds.find((roundEntry) => roundEntry.eventId === event.event.id);
      if (!existing) {
        state.rounds.push({
          eventId: event.event.id,
          round: event.event.round,
          date: event.event.date,
          season,
          ratings: new Map(state.lastRoundRatings),
        });
      } else {
        existing.ratings = new Map(state.lastRoundRatings);
      }
    }
  }

  const output = { analysis: 'ratings', method: {
    model: 'Elo, every finisher compared with every other finisher in the same moto',
    k: K,
    entrant: `a new rider enters at the class median and the scale starts at ${START}`,
    leaderboardMinimum: `${MIN_MOTOS_LEADERBOARD} motos`,
    continuity: 'one rating per class across all seasons; changing a plate number does not restart it',
  }, classes: {} };

  for (const [className, state] of [...classes.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const seasonRows = [];
    for (const [season, seasonState] of [...state.seasons.entries()].sort((a, b) => a[0] - b[0])) {
      const riders = [...seasonState.riders.values()]
        .filter((rider) => rider.motos >= 1)
        .map((rider) => ({
          riderId: rider.riderId,
          name: rider.name,
          motos: rider.motos,
          start: round(rider.start),
          rating: round(rider.end),
          delta: round(rider.end - rider.start),
          peak: round(rider.peak),
        }))
        .sort((a, b) => b.rating - a.rating || cmp(a.riderId, b.riderId));

      const leaders = riders.filter((rider) => rider.motos >= MIN_MOTOS_LEADERBOARD).slice(0, 25);
      const topIds = riders.slice(0, TRAJECTORY_RIDERS).map((rider) => rider.riderId);
      const rounds = state.rounds.filter((roundEntry) => roundEntry.season === season);

      const trajectory = topIds.map((riderId) => {
        let carried = null;
        const points = rounds.map((roundEntry) => {
          const value = roundEntry.ratings.get(riderId);
          if (value !== undefined) carried = round(value);
          return carried;
        });
        return { riderId, name: state.names.get(riderId), ratings: points };
      });

      seasonRows.push({
        season,
        riders,
        leaders,
        rounds: rounds.map((roundEntry) => ({ eventId: roundEntry.eventId, round: roundEntry.round, date: roundEntry.date })),
        trajectory,
      });
    }

    const allTime = [...state.ratings.entries()]
      .map(([riderId, rating]) => {
        let motos = 0;
        for (const seasonState of state.seasons.values()) {
          motos += seasonState.riders.get(riderId)?.motos ?? 0;
        }
        return { riderId, name: state.names.get(riderId), rating: round(rating), motos };
      })
      .filter((rider) => rider.motos >= MIN_MOTOS_LEADERBOARD)
      .sort((a, b) => b.rating - a.rating || cmp(a.riderId, b.riderId))
      .slice(0, 25);

    output.classes[className] = { seasons: seasonRows, allTime };
  }

  output.coverage = {
    classes: Object.keys(output.classes),
    note: 'ratings are relative to the field a rider met; they are not comparable across classes',
  };
  return output;
}

function getSeason(state, season) {
  if (!state.seasons.has(season)) state.seasons.set(season, { season, riders: new Map() });
  return state.seasons.get(season);
}

function getRiderSeason(seasonState, riderId, name, start) {
  if (!seasonState.riders.has(riderId)) {
    seasonState.riders.set(riderId, {
      riderId,
      name,
      motos: 0,
      start,
      end: start,
      peak: null,
    });
  }
  return seasonState.riders.get(riderId);
}
