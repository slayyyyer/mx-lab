// Rider and track indexes.
//
// Both are read-only aggregations of the same event files: no new judgement is
// made here, so the counts can be checked against the dataset by hand. A rider
// is identified by `riderId` (the name-based identity shared by both eras), not
// by plate number, so a number change does not split a career. A track is the
// printed track name, because the archive's event names vary by sponsor.

import { cmp, seasonOf, sortedEvents, sortedMotos } from './common.js';

const seriesOf = (className) => (className.includes('SX') ? 'Supercross' : 'Motocross');

export function buildEntities(events) {
  const riders = new Map();
  const tracks = new Map();
  const seasons = new Set();

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    seasons.add(season);
    const trackName = event.event.track ?? event.event.name ?? 'Unknown';
    if (!tracks.has(trackName)) {
      tracks.set(trackName, {
        track: trackName,
        events: new Set(),
        seasons: new Set(),
        classes: new Set(),
        motos: 0,
        rows: 0,
        winners: new Set(),
        last: null,
      });
    }
    const track = tracks.get(trackName);
    track.events.add(event.event.id);
    track.seasons.add(season);
    track.last = { id: event.event.id, name: event.event.name, date: event.event.date, season };

    for (const moto of sortedMotos(event)) {
      track.classes.add(moto.class);
      track.motos += 1;
      for (const row of moto.results ?? []) {
        track.rows += 1;
        if (Number.isInteger(row.pos) && row.pos <= 3) track.winners.add(row.riderId);

        if (!riders.has(row.riderId)) {
          riders.set(row.riderId, {
            riderId: row.riderId,
            name: row.name,
            starts: 0,
            wins: 0,
            podiums: 0,
            top10s: 0,
            best: null,
            seasons: new Set(),
            classes: new Set(),
            series: new Set(),
            last: null,
          });
        }
        const rider = riders.get(row.riderId);
        rider.name = row.name ?? rider.name;
        rider.starts += 1;
        rider.seasons.add(season);
        rider.classes.add(moto.class);
        rider.series.add(seriesOf(moto.class));
        if (Number.isFinite(row.pos)) {
          rider.best = rider.best === null ? row.pos : Math.min(rider.best, row.pos);
          if (row.pos === 1) rider.wins += 1;
          if (row.pos <= 3) rider.podiums += 1;
          if (row.pos <= 10) rider.top10s += 1;
        }
        rider.last = { season, event: event.event.name, date: event.event.date, class: moto.class };
      }
    }
  }

  const riderRows = [...riders.values()]
    .map((rider) => ({
      riderId: rider.riderId,
      name: rider.name,
      starts: rider.starts,
      wins: rider.wins,
      podiums: rider.podiums,
      top10s: rider.top10s,
      best: rider.best,
      seasons: [...rider.seasons].sort((a, b) => a - b),
      classes: [...rider.classes].sort(),
      series: [...rider.series].sort(),
      last: rider.last,
    }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.podiums - a.podiums ||
        b.starts - a.starts ||
        cmp(a.riderId, b.riderId),
    );

  const trackRows = [...tracks.values()]
    .map((track) => ({
      track: track.track,
      events: track.events.size,
      seasons: [...track.seasons].sort((a, b) => a - b),
      classes: [...track.classes].sort(),
      motos: track.motos,
      rows: track.rows,
      riders: track.winners.size,
      last: track.last,
    }))
    .sort((a, b) => b.events - a.events || cmp(a.track, b.track));

  return {
    analysis: 'entities',
    method: {
      rider: 'one entry per riderId, across both eras and every class; plate changes do not split a career',
      track: 'one entry per printed track name',
      counted: 'every moto entry in the dataset; wins and podiums use the finishing position',
    },
    coverage: {
      riders: riderRows.length,
      tracks: trackRows.length,
      seasons: [...seasons].sort((a, b) => a - b),
    },
    riders: riderRows,
    tracks: trackRows,
  };
}
