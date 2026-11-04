// 6.1 — the lap chart.
//
// Only 2025–2026 carries a position on each lap: the timing system prints one
// per row of the lap table. For 2020–2024 the dataset has lap *times* and no
// positions, and none are invented (ADR 0003). The chart therefore names its
// coverage on the page instead of quietly starting in 2025.
//
// The chart keeps the top 20 finishers of each moto. A 40-line chart is
// unreadable, and the riders who were lapped are the ones whose positions the
// source itself calls into question.

import { seasonOf, sortedEvents, sortedMotos } from './common.js';

export const LAP_CHART_SEASONS = [2025, 2026];
const TOP_N = 20;

export function buildLapChart(events) {
  const races = [];
  let motoCount = 0;
  let riderCount = 0;
  let lapCount = 0;
  let lapsWithoutPosition = 0;

  for (const event of sortedEvents(events)) {
    const season = seasonOf(event);
    if (!LAP_CHART_SEASONS.includes(season)) continue;

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

  return {
    analysis: 'lap-chart',
    method: {
      charted: `top ${TOP_N} finishers of each moto`,
      source: 'per-lap position printed by the timing system',
      seasons: LAP_CHART_SEASONS,
    },
    coverage: {
      seasons: LAP_CHART_SEASONS,
      events: races.length,
      motos: motoCount,
      riders: riderCount,
      lapsWithPosition: lapCount,
      lapsWithoutPosition,
      periods: '2025–2026 only: the 2020–2024 sheets print no per-lap position and none is derived',
    },
    races,
  };
}
