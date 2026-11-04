// The validation gate.
//
// This is a gate, not a warning system: a parser that silently misreads a sheet
// is the dominant correctness risk (ADR 0001), so contradictions inside the
// data fail the build. Two kinds of finding are deliberately separated:
//
//   errors   - a structural contradiction the parser controls: duplicate or
//              non-contiguous positions, duplicate plates, a missing rider id,
//              a malformed source hash. These mean the parse is wrong.
//   warnings - an anomaly in the source itself: a rider's fast lap printed as
//              the `MIN` summary instead of a lap line, a lap time of 29:24.473
//              printed after a red flag, a published best time faster than every
//              listed session. The dataset records what the source says and
//              names the anomaly; it never rewrites a value to look plausible.
//
// The split matters: failing a build for a source quirk would only teach the
// next person to switch the gate off.

const MIN_PLAUSIBLE_LAP_MS = 50_000;
const MAX_PLAUSIBLE_LAP_MS = 400_000;

export function validateEvent(event) {
  const errors = [];
  const warnings = [];

  if (!event || typeof event !== 'object') return { errors: ['event: not an object'], warnings };
  if (!event.event?.id) errors.push('event: missing id');
  if (!Array.isArray(event.motos) || event.motos.length === 0) {
    errors.push('event: no motos');
    return { errors, warnings };
  }

  const seenMotos = new Set();
  const platesByClass = new Map();

  for (const moto of event.motos) {
    const key = `${moto.class} Moto ${moto.moto}`;
    if (seenMotos.has(key)) errors.push(`${key}: duplicate moto`);
    seenMotos.add(key);

    const results = moto.results ?? [];
    if (results.length === 0) {
      errors.push(`${key}: no results`);
      continue;
    }

    const plates = new Set();
    const positions = new Set();
    const shortOfLaps = [];
    const noLapTimes = [];
    let maxLaps = 0;
    for (const row of results) {
      if (row.lapsCompleted && row.lapsCompleted > maxLaps) maxLaps = row.lapsCompleted;
    }

    for (const row of results) {
      const label = `${key} #${row.plate}`;
      if (!Number.isInteger(row.pos) || row.pos < 1) errors.push(`${label}: bad position ${row.pos}`);
      if (positions.has(row.pos)) errors.push(`${label}: duplicate position ${row.pos}`);
      positions.add(row.pos);
      if (!Number.isInteger(row.plate) || row.plate < 1) errors.push(`${label}: bad plate`);
      if (plates.has(row.plate)) errors.push(`${label}: duplicate plate`);
      plates.add(row.plate);
      if (!row.riderId) errors.push(`${label}: missing riderId`);

      const laps = row.laps ?? [];
      const seenLaps = new Set();
      for (const lap of laps) {
        if (seenLaps.has(lap.lap)) errors.push(`${label}: duplicate lap ${lap.lap}`);
        seenLaps.add(lap.lap);
        if (lap.timeMs === null) {
          if (lap.lap !== 1) warnings.push(`${label}: no time recorded for lap ${lap.lap}`);
          continue;
        }
        if (lap.timeMs < MIN_PLAUSIBLE_LAP_MS || lap.timeMs > MAX_PLAUSIBLE_LAP_MS) {
          // The source does print these: #117 lap 3 at Loretta Lynn's 2020 is
          // 29:24.473, a whole moto's worth of time on one lap.
          warnings.push(`${label}: implausible lap ${lap.lap} time ${lap.timeMs}ms`);
        }
      }

      const expectedLaps = row.lapsCompleted ?? (row.status ? null : maxLaps);
      if (expectedLaps !== null && laps.length > 0 && laps.length !== expectedLaps) {
        shortOfLaps.push(row.plate);
      }
      if (expectedLaps !== null && laps.length === 0) {
        noLapTimes.push(row.plate);
      }

      // Strict only when the lap list is complete: otherwise a missing fastest
      // lap is a source gap, already reported above.
      if (row.bestLapMs !== null && row.bestLapMs !== undefined && laps.length > 0 && laps.length === expectedLaps) {
        const fastest = Math.min(...laps.filter((lap) => lap.timeMs !== null).map((lap) => lap.timeMs));
        if (Number.isFinite(fastest) && fastest !== row.bestLapMs) {
          warnings.push(`${label}: results best lap ${row.bestLapMs}ms is not in the lap list (fastest ${fastest}ms)`);
        }
      }
    }

    // One warning per moto rather than one per rider: at Pala this happens for
    // 18 of 40 riders, because the sheet prints the `MIN` summary in the final
    // lap's slot for them. That is a source gap, and the dataset records it as
    // `laps.length` shorter than `lapsCompleted`.
    if (shortOfLaps.length > 0) {
      warnings.push(
        `${key}: ${shortOfLaps.length} rider(s) have fewer lap times than completed laps ` +
          `(the sheet prints MIN in place of the final lap for them): #${shortOfLaps.join(', #')}`,
      );
    }
    if (noLapTimes.length > 0) {
      warnings.push(`${key}: no lap times recorded at all for #${noLapTimes.join(', #')}`);
    }

    platesByClass.set(moto.class, new Set([...(platesByClass.get(moto.class) ?? []), ...plates]));
  }

  for (const session of event.qualifying ?? []) {
    const label = `qualifying ${session.class} ${session.session}`;
    let previousBest = -Infinity;
    const qualifiedPlates = new Set();
    for (const row of session.rows ?? []) {
      qualifiedPlates.add(row.plate);
      const sessionTimes = (row.sessions ?? []).filter((time) => typeof time === 'number');
      if (row.bestMs === null || row.bestMs === undefined) {
        // A rider who never completed a timed lap is still on the entry list.
        warnings.push(`${label} #${row.plate}: no best time recorded`);
        continue;
      }
      if (sessionTimes.length > 0) {
        const fastest = Math.min(...sessionTimes);
        if (fastest !== row.bestMs) {
          warnings.push(`${label} #${row.plate}: best ${row.bestMs}ms but fastest listed session is ${fastest}ms`);
        }
      }
      if (row.bestMs < previousBest) {
        warnings.push(`${label} #${row.plate}: slower best time ranked ahead of the rider in front`);
      }
      previousBest = row.bestMs;
    }

    // The qualifying sheet lists every entrant (71 at Pala), while the moto has
    // 40: riders who did not qualify are expected to be absent from both. A
    // rider who lined up for a moto but has no qualifying row is the real gap.
    for (const plate of platesByClass.get(session.class) ?? []) {
      if (!qualifiedPlates.has(plate)) {
        warnings.push(`${label}: #${plate} lined up but has no qualifying row`);
      }
    }
  }

  for (const source of event.sources ?? []) {
    if (!source.url || !/^[0-9a-f]{64}$/.test(source.sha256 ?? '')) {
      errors.push(`source: malformed entry ${source.url ?? '(no url)'}`);
    }
  }

  return { errors, warnings: [...new Set(warnings)].sort() };
}
