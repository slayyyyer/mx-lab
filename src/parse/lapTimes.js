// INDIVIDUAL LAP TIMES sheet (`M1F1RID.pdf` style).
//
// Ten riders per page in fixed columns, one line per lap:
//
//        #1                #4              #7    ...
//   J. Lawrence          C. Sexton     A. Plessinger
//        HON               KTM             KTM
//   1    --.---      1    --.---    1    --.---
//   2   2:25.399     2  2:28.050    2  2:25.580
//
// Hazards this parser is built around:
//   - Lap 1 has no time (`--.---`): it is the start, not a zero-second lap.
//   - The `MIN`/`MAX`/`AVG` summary block is printed below the laps, but for a
//     rider with fewer recorded laps it shifts upward and lands on a lap line
//     for that column. So the lap number is taken from each cell, and a cell
//     whose first token is MIN/MAX/AVG is a summary, never a lap.
//   - Column windows come from the `#plate` header offsets, because a blank
//     cell would otherwise shift every following column by one rider.
//   - Names here are abbreviated (`J. Lawrence`) and must be joined to the
//     results sheet by plate, not by name.

import { DASH_TIME, boundsFromHeaders, isTime, parseTime, sliceColumns } from '../lib/text.js';

export const LAP_TIMES_PARSER_ID = 'ama/lap-times/layout-2024';

const SUMMARY_RE = /^(MIN|MAX|AVG)$/;

export function parseLapTimes(text) {
  const pages = text.split('\f');
  const riders = [];
  const warnings = [];

  pages.forEach((page, pageIndex) => {
    const lines = page.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => /^\s*#\d+/.test(line));
    if (headerIndex < 0) return;

    const header = lines[headerIndex];
    const bounds = boundsFromHeaders(header);
    const plates = [...header.matchAll(/#\s*(\d+)/g)].map((match) => Number(match[1]));
    if (!bounds || bounds.length !== plates.length) {
      throw new Error(`lap times: unreadable column header on page ${pageIndex + 1}`);
    }

    const names = sliceColumns(lines[headerIndex + 1] ?? '', bounds);
    const bikes = sliceColumns(lines[headerIndex + 2] ?? '', bounds);

    const entries = plates.map((plate, index) => ({
      plate,
      name: (names[index] ?? '').trim(),
      bike: (bikes[index] ?? '').trim(),
      laps: new Map(),
      min: null,
      max: null,
      avg: null,
    }));

    for (let i = headerIndex + 3; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (/page\s+\d+/i.test(line)) break;

      const cells = sliceColumns(line, bounds);
      cells.forEach((cell, index) => {
        if (!cell) return;
        const entry = entries[index];
        if (!entry) return;
        const tokens = cell.split(/\s+/);
        const [first, second] = tokens;

        if (/^\d+$/.test(first) && (isTime(second) || second === DASH_TIME)) {
          const lap = Number(first);
          if (entry.laps.has(lap)) {
            throw new Error(`lap times: duplicate lap ${lap} for #${entry.plate} on page ${pageIndex + 1}`);
          }
          entry.laps.set(lap, parseTime(second));
          return;
        }

        if (SUMMARY_RE.test(first) && (isTime(second) || second === DASH_TIME)) {
          entry[first.toLowerCase()] = parseTime(second);
          return;
        }

        warnings.push(`#${entry.plate}: unparsed cell "${cell}" on page ${pageIndex + 1}`);
      });
    }

    for (const entry of entries) {
      if (entry.laps.size === 0) continue;
      riders.push({
        plate: entry.plate,
        name: entry.name,
        bike: entry.bike,
        minMs: entry.min,
        maxMs: entry.max,
        avgMs: entry.avg,
        laps: [...entry.laps.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([lap, timeMs]) => ({ lap, timeMs })),
      });
    }
  });

  if (riders.length === 0) throw new Error('lap times: no riders parsed');

  return { parser: LAP_TIMES_PARSER_ID, riders, warnings };
}
