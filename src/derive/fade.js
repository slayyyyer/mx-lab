// 6.2 — fade.
//
// Written as a position fade in the handoff, which would have confined it to
// 2025–2026 (only those seasons print per-lap positions). The question it asks —
// who holds pace and who drops — is a *time* question, so it is measured from
// lap times and covers all seven seasons.
//
// Method: take laps 2..N (lap 1 includes the start and is missing for part of
// the 2020–2024 field), drop obvious stoppages (a lap more than 1.4× the rider's
// own median — a pit stop or a crash, not fading), then compare the median of
// the second half with the median of the first. Median rather than mean so one
// surviving slow lap cannot decide the result. A moto needs at least six usable
// laps both before and after the split, or it is skipped and counted.

import { cmp, median, round, seasonOf, sortedEvents, sortedMotos } from './common.js';

const MIN_LAPS = 6;
const OUTLIER_FACTOR = 1.4;

export function riderFade(row) {
  const laps = (row.laps ?? [])
    .filter((lap) => Number.isFinite(lap.timeMs) && lap.lap >= 2)
    .sort((a, b) => a.lap - b.lap)
    .map((lap) => lap.timeMs);
  if (laps.length < MIN_LAPS) return null;

  const centre = median(laps);
  const kept = laps.filter((time) => time <= centre * OUTLIER_FACTOR);
  if (kept.length < MIN_LAPS) return null;

  const half = Math.floor(kept.length / 2);
  const first = median(kept.slice(0, half));
  const last = median(kept.slice(-half));
  if (!Number.isFinite(first) || first <= 0) return null;

  return { fadePct: ((last - first) / first) * 100, laps: kept.length };
}

export function buildFade(events) {
  const seasonRows = new Map();
  const trackRows = [];
  const riders = new Map();
  let riderMotos = 0;
  let skipped = 0;
  let laps = 0;

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    if (!seasonRows.has(season)) seasonRows.set(season, { season, values: [], riders: 0, tracks: 0 });
    const seasonRow = seasonRows.get(season);
    const eventValues = [];
    let eventRiderMotos = 0;

    for (const moto of sortedMotos(event)) {
      const values = [];
      for (const row of moto.results ?? []) {
        const result = riderFade(row);
        if (!result) {
          skipped += 1;
          continue;
        }
        riderMotos += 1;
        laps += result.laps;
        values.push(result.fadePct);
        seasonRow.values.push(result.fadePct);

        const key = `${season}:${row.riderId}`;
        if (!riders.has(key)) {
          riders.set(key, { riderId: row.riderId, name: row.name, season, values: [] });
        }
        riders.get(key).values.push(result.fadePct);
      }

      if (values.length > 0) {
        seasonRow.riders += values.length;
        seasonRow.tracks += 1;
        eventValues.push(...values);
        eventRiderMotos += values.length;
      }
    }

    // One row per round, not per moto: the round is the unit a reader is looking at.
    if (eventValues.length > 0) {
      trackRows.push({
        season,
        eventId: event.event.id,
        name: event.event.name,
        track: event.event.track,
        round: event.event.round,
        date: event.event.date,
        riderMotos: eventRiderMotos,
        medianFadePct: round(median(eventValues)),
      });
    }
  }

  const seasons = [...seasonRows.values()]
    .filter((row) => row.values.length > 0)
    .map((row) => ({
      season: row.season,
      riderMotos: row.riders,
      motos: row.tracks,
      medianFadePct: round(median(row.values)),
    }))
    .sort((a, b) => a.season - b.season);

  const leaderboard = [...riders.values()]
    .filter((row) => row.values.length >= 10)
    .map((row) => ({
      riderId: row.riderId,
      name: row.name,
      season: row.season,
      motos: row.values.length,
      medianFadePct: round(median(row.values)),
      bestFadePct: round(Math.min(...row.values)),
      worstFadePct: round(Math.max(...row.values)),
    }))
    .sort((a, b) => cmp(a.medianFadePct, b.medianFadePct) || cmp(a.riderId, b.riderId));

  trackRows.sort(
    (a, b) => cmp(a.season, b.season) || (a.round ?? 0) - (b.round ?? 0) || cmp(a.eventId, b.eventId),
  );

  return {
    analysis: 'fade',
    method: {
      metric: 'percent change in median lap time, first half to second half of a moto',
      window: 'laps 2..N',
      outlier: `laps slower than ${OUTLIER_FACTOR}× the rider's own median are dropped`,
      minimumLaps: MIN_LAPS,
      entrant: 'a rider-season needs 10 measured motos to appear on the leaderboard',
    },
    coverage: {
      seasons: seasons.map((row) => row.season),
      riderMotos,
      riderMotosSkipped: skipped,
      lapsUsed: laps,
      periods: 'all seven seasons: lap times exist on both sources',
    },
    seasons,
    tracks: trackRows,
    riders: leaderboard,
  };
}
