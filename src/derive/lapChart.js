// 6.1 — the lap chart.
//
// Positions come from two places. 2025–2026 prints one per row of the lap table;
// 2020–2024 Supercross prints a LAP CHART grid (position rows, plate cells) that
// is inverted into the same shape. Motocross before 2025 has no chart sheet and
// no position is invented for it. The chart names its coverage on the page.
//
// The chart keeps the top 20 finishers of each moto. A 40-line chart is
// unreadable, and the riders who were lapped are the ones whose positions the
// source itself calls into question.

import { seasonOf, sortedEvents, sortedMotos } from './common.js';

export const LAP_CHART_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
const TOP_N = 20;

export function buildLapChart(events) {
  const races = [];
  let motoCount = 0;
  let riderCount = 0;
  let lapCount = 0;
  let lapsWithoutPosition = 0;

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);

    const motos = [];
    for (const moto of sortedMotos(event)) {
      const rows = [...(moto.results ?? [])].sort((a, b) => a.pos - b.pos);
      const charted = rows.filter((row) => (row.laps ?? []).some((lap) => lap.position != null));
      if (charted.length === 0) continue;

      const laps = Math.max(...charted.map((row) => row.laps.length));
      const riders = charted.slice(0, TOP_N).map((row) => {
        const positions = [];
        for (const lap of row.laps) {
          if (lap.position == null) lapsWithoutPosition += 1;
          else lapCount += 1;
          positions.push(lap.position ?? null);
        }
        while (positions.length < laps) positions.push(null);
        return {
          riderId: row.riderId,
          name: row.name,
          plate: row.plate,
          finish: row.pos,
          status: row.status,
          positions,
        };
      });

      riderCount += riders.length;
      motoCount += 1;
      motos.push({ class: moto.class, moto: moto.moto, laps, riders });
    }

    if (motos.length === 0) continue;
    races.push({
      id: event.event.id,
      name: event.event.name,
      track: event.event.track,
      date: event.event.date,
      season,
      round: event.event.round,
      motos,
    });
  }

  const chartedSeasons = [...new Set(races.map((race) => race.season))].sort((a, b) => a - b);

  return {
    analysis: 'lap-chart',
    method: {
      charted: `top ${TOP_N} finishers of each moto`,
      source: 'per-lap position from the timing system (2025–2026) or the LAP CHART grid (2020–2024 Supercross)',
      seasons: chartedSeasons,
    },
    coverage: {
      seasons: chartedSeasons,
      events: races.length,
      motos: motoCount,
      riders: riderCount,
      lapsWithPosition: lapCount,
      lapsWithoutPosition,
      periods:
        '2020–2024 Supercross positions are inverted from the LAP CHART sheet; 2025–2026 from the timing system; pre-2025 Motocross and Triple Crown rounds print no chart and are not charted',
    },
    races,
  };
}
