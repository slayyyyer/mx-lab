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

// Glicko-2 over the same motos and the same pairwise comparisons. It is carried
// alongside Elo for one reason: the rating deviation. A rating earned over three
// motos is not as settled as one earned over thirty, and RD says so.
const GLICKO_SCALE = 173.7178;
const GLICKO_TAU = 0.5;
const GLICKO_RD = 350;
const GLICKO_VOLATILITY = 0.06;

const gFactor = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

function volatilityStep(phi, delta, variance, volatility) {
  const a = Math.log(volatility * volatility);
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - variance - ex);
    const den = 2 * (phi * phi + variance + ex) ** 2;
    return num / den - (x - a) / (GLICKO_TAU * GLICKO_TAU);
  };
  let A = a;
  let B;
  if (delta * delta > phi * phi + variance) {
    B = Math.log(delta * delta - phi * phi - variance);
  } else {
    let k = 1;
    while (f(a - k * GLICKO_TAU) < 0) k += 1;
    B = a - k * GLICKO_TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i += 1) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

export function glickoMoto(state, order) {
  const updates = new Map();
  if (order.length < 2) return updates;
  for (let i = 0; i < order.length; i += 1) {
    const me = state.get(order[i]);
    if (!me) continue;
    const mu = (me.rating - 1500) / GLICKO_SCALE;
    const phi = me.rd / GLICKO_SCALE;
    let varianceSum = 0;
    let deltaSum = 0;
    for (let j = 0; j < order.length; j += 1) {
      if (i === j) continue;
      const other = state.get(order[j]);
      if (!other) continue;
      const muOpponent = (other.rating - 1500) / GLICKO_SCALE;
      const phiOpponent = other.rd / GLICKO_SCALE;
      const gOpponent = gFactor(phiOpponent);
      const expected = 1 / (1 + Math.exp(-gOpponent * (mu - muOpponent)));
      const score = i < j ? 1 : 0;
      varianceSum += gOpponent * gOpponent * expected * (1 - expected);
      deltaSum += gOpponent * (score - expected);
    }
    if (varianceSum === 0) continue;
    const variance = 1 / varianceSum;
    const delta = variance * deltaSum;
    const volatility = volatilityStep(phi, delta, variance, me.volatility ?? GLICKO_VOLATILITY);
    const phiStar = Math.sqrt(phi * phi + volatility * volatility);
    const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / variance);
    const muNew = mu + phiNew * phiNew * deltaSum;
    updates.set(order[i], {
      rating: 1500 + GLICKO_SCALE * muNew,
      rd: GLICKO_SCALE * phiNew,
      volatility,
    });
  }
  return updates;
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
          glicko: new Map(),
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
          state.glicko.set(row.riderId, { rating: START, rd: GLICKO_RD, volatility: GLICKO_VOLATILITY });
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
      const glickoUpdates = glickoMoto(state.glicko, order);
      for (const [riderId, delta] of deltas) {
        state.ratings.set(riderId, state.ratings.get(riderId) + delta);
      }
      for (const [riderId, next] of glickoUpdates) state.glicko.set(riderId, next);
      for (const row of rows) {
        const stat = getRiderSeason(seasonState, row.riderId, row.name, state.ratings.get(row.riderId));
        stat.end = state.ratings.get(row.riderId);
        stat.peak = stat.peak === null ? stat.end : Math.max(stat.peak, stat.end);
        const glicko = state.glicko.get(row.riderId);
        stat.glickoEnd = glicko.rating;
        stat.glickoRd = glicko.rd;
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
    glicko: 'Glicko-2 over the same pairwise moto comparisons, with an initial deviation of 350 and tau 0.5; the deviation is the point — it says how settled the number is',
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
          glicko: round(rider.glickoEnd),
          glickoRd: round(rider.glickoRd),
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
        const glicko = state.glicko.get(riderId);
        return {
          riderId,
          name: state.names.get(riderId),
          rating: round(rating),
          glicko: round(glicko.rating),
          glickoRd: round(glicko.rd),
          motos,
        };
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
      glickoEnd: 1500,
      glickoRd: GLICKO_RD,
    });
  }
  return seasonState.riders.get(riderId);
}
