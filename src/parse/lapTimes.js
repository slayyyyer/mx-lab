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

import { DASH_TIME, boundsFromHeaders, parseTime, sliceColumns } from '../lib/text.js';

export const LAP_TIMES_PARSER_ID = 'ama/lap-times/layout-2024';

// Numeric columns are right-aligned, so a wide value (`12:05.101`) starts left of
// its header offset and drags the previous column's last digit into this cell.
// The lap number is therefore read from the last `<lap> <time>` pair in the cell,
// never from the first two tokens.
const TIME_PATTERN = `(?:\\d{1,2}:)?\\d{1,3}\\.\\d{1,3}`;
const DASH_PATTERN = DASH_TIME.replace(/\./g, '\\.');
const SUMMARY_PATTERN = new RegExp(`\\b(MIN|MAX|AVG)\\s+(${TIME_PATTERN}|${DASH_PATTERN})`, 'g');
const LAP_PATTERN = new RegExp(`(\\d{1,2})\\s+(${TIME_PATTERN}|${DASH_PATTERN})`, 'g');

function lastPair(cell, pattern) {
  pattern.lastIndex = 0;
  let found = null;
  for (let match = pattern.exec(cell); match; match = pattern.exec(cell)) found = match;
  return found;
}

// Some sheets print one extra entry at the end of a rider's column, repeating the
// lap number already printed (2020 Ironman #139: `1..15`, then `15` again). The
// results sheet gives the same rider 15 completed laps, so the repeated entry is
// an artefact: the first entry for a lap number is kept and the later repeat is
// dropped with a warning. A hole, or any other out-of-order number, is refused.
function normalizeLaps(entry) {
  const laps = [];
  const dropped = [];
  let last = 0;

  for (const row of entry.rows) {
    if (row.printed === last + 1) {
      laps.push({ lap: row.printed, timeMs: row.timeMs });
      last = row.printed;
      continue;
    }
    // A skipped number is a hole in the record; never invent a lap for it.
    if (row.printed > last + 1) return null;
    // Only a repeat of the lap just printed is a known artefact.
    if (row.printed !== last) return null;
    dropped.push({ lap: row.printed, timeMs: row.timeMs });
  }

  return { laps, dropped };
}

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
      rows: [],
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
        const summary = lastPair(cell, SUMMARY_PATTERN);
        if (summary) {
          entry[summary[1].toLowerCase()] = parseTime(summary[2]);
          return;
        }

        const lap = lastPair(cell, LAP_PATTERN);
        if (lap) {
          entry.rows.push({ printed: Number(lap[1]), timeMs: parseTime(lap[2]) });
          return;
        }

        warnings.push(`#${entry.plate}: unparsed cell "${cell}" on page ${pageIndex + 1}`);
      });
    }

    for (const entry of entries) {
      if (entry.rows.length === 0) continue;
      const normalized = normalizeLaps(entry);
      if (!normalized) {
        throw new Error(
          `lap times: lap numbers for #${entry.plate} on page ${pageIndex + 1} are not a contiguous sequence`,
        );
      }
      const { laps, dropped } = normalized;
      for (const repeat of dropped) {
        warnings.push(
          `#${entry.plate} page ${pageIndex + 1}: lap ${repeat.lap} printed twice, the second entry (${repeat.timeMs}ms) was dropped`,
        );
      }
      riders.push({
        plate: entry.plate,
        name: entry.name,
        bike: entry.bike,
        minMs: entry.min,
        maxMs: entry.max,
        avgMs: entry.avg,
        laps,
      });
    }
  });

  if (riders.length === 0) throw new Error('lap times: no riders parsed');

  return { parser: LAP_TIMES_PARSER_ID, riders, warnings };
}
