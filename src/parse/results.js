// PROVISIONAL RESULTS sheet (`M1F1RES.pdf` style).
//
// Row shape, verified on 2024 M2405:
//   POS  #  RIDER  HOMETOWN  BIKE  INTERVAL  BEST TIME  TEAM/SPONSORS
// where INTERVAL is `15 Laps` for the winner, `+05.058` / `+1:44.995` for
// everyone else, `8 Laps` for a rider laps down, or `DNF`.
//
// Hazards this parser is built around:
//   - The class comes from the title line, never the sheet code: M1F1 is 450
//     Moto 1, but M1F2 is 450 Moto 2 while M2F1 is 250 Moto 1.
//   - A long name pushes the rest of the row onto a continuation line (250 Moto
//     1 at Pala does this for #108). Such a row is reassembled from its
//     continuation only when the interval field is missing.
//   - The table ends at the session-notes block. A later page carries a
//     lap-leader table whose rows also begin `pos  plate`.
//   - A row that still cannot be parsed is refused loudly. Positions are then
//     required to be contiguous 1..n, which is how a silently dropped row is
//     caught.

import { isTime, parseGap, parseTime, positionsContiguous, splitCells } from '../lib/text.js';

export const RESULTS_PARSER_ID = 'ama/results/layout-2024';

const ROW_HEAD_RE = /^\s*(\d+)\s+(\d+)\s*(.*)$/;
const INTERVAL_RE = /^(?:\d+ Laps|DNF|DNS|DSQ|DSNP)$/;

function findIntervalIndex(cells) {
  for (let index = 3; index < Math.min(cells.length, 7); index += 1) {
    const cell = cells[index];
    if (INTERVAL_RE.test(cell) || cell.startsWith('+')) return index;
  }
  return -1;
}

export function parseResults(text) {
  const lines = text.split(/\r?\n/);

  const titleIndex = lines.findIndex((line) => /RESULTS\s*-\s*\d{3}MX\s*MOTO\s*#\d/i.test(line));
  if (titleIndex < 0) throw new Error('results: no session title line');
  const title = lines[titleIndex].match(/(\d{3}MX)\s*MOTO\s*#(\d)/i);
  const className = title[1];
  const moto = Number(title[2]);

  const roundMatch = lines.join('\n').match(/ROUND\s+(\d+)\s+OF\s+(\d+)/i);
  const round = roundMatch ? Number(roundMatch[1]) : null;
  const ofRounds = roundMatch ? Number(roundMatch[2]) : null;

  const headerIndex = lines.findIndex((line) => /POS\./.test(line) && /RIDER/.test(line));
  if (headerIndex < 0) throw new Error('results: no column header');

  const notesIndex = lines.findIndex(
    (line, index) => index > headerIndex && /SESSION NOTES|Humidity:|RACE TIME:/i.test(line),
  );
  const endIndex = notesIndex === -1 ? lines.length : notesIndex;

  // Group physical lines into logical rows: a row starts at `pos plate` and
  // absorbs any following line that does not start a new row.
  const logical = [];
  let current = null;
  for (let i = headerIndex + 1; i < endIndex; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      if (current) {
        logical.push(current);
        current = null;
      }
      continue;
    }
    const head = line.match(ROW_HEAD_RE);
    if (head) {
      if (current) logical.push(current);
      current = {
        pos: Number(head[1]),
        plate: Number(head[2]),
        cells: splitCells(head[3]),
        continuations: [],
        lineNumber: i + 1,
      };
      continue;
    }
    if (current) current.continuations.push(line);
  }
  if (current) logical.push(current);

  const rows = logical.map((entry) => {
    let cells = entry.cells;
    let intervalIndex = findIntervalIndex(cells);
    if (intervalIndex < 0 && entry.continuations.length > 0) {
      cells = [...cells, ...splitCells(entry.continuations.join(' '))];
      intervalIndex = findIntervalIndex(cells);
    }
    if (intervalIndex < 0) {
      throw new Error(
        `results: unsupported layout at line ${entry.lineNumber}: no interval field (${cells.join(' ').slice(0, 60)})`,
      );
    }

    const name = cells[0] ?? '';
    if (!/[A-Za-z]/.test(name)) {
      throw new Error(`results: unsupported layout at line ${entry.lineNumber}: no rider name`);
    }
    const hometown = cells[1] ?? '';
    const bike = cells[2] ?? '';

    const intervalRaw = cells[intervalIndex];
    let lapsCompleted = null;
    let status = null;
    let gapMs = null;
    if (INTERVAL_RE.test(intervalRaw)) {
      const laps = intervalRaw.match(/^(\d+) Laps$/);
      if (laps) lapsCompleted = Number(laps[1]);
      else status = intervalRaw;
    } else {
      gapMs = parseGap(intervalRaw);
      if (gapMs === null) {
        throw new Error(`results: unparsable interval "${intervalRaw}" at line ${entry.lineNumber}`);
      }
    }

    let bestLapMs = null;
    let teamCellIndex = intervalIndex + 1;
    if (isTime(cells[teamCellIndex] ?? '')) {
      bestLapMs = parseTime(cells[teamCellIndex]);
      teamCellIndex += 1;
    }
    const team = cells.slice(teamCellIndex).join('  ');

    return {
      pos: entry.pos,
      plate: entry.plate,
      name,
      hometown,
      bike,
      lapsCompleted,
      status,
      gapMs,
      gapRaw: intervalRaw.startsWith('+') ? intervalRaw : null,
      bestLapMs,
      team: team || null,
    };
  });

  if (rows.length === 0) throw new Error('results: header found but no rows parsed');
  if (!positionsContiguous(rows.map((row) => row.pos))) {
    throw new Error(`results: positions are not contiguous 1..${rows.length}; a row likely wrapped (unsupported layout)`);
  }

  return {
    parser: RESULTS_PARSER_ID,
    class: className,
    moto,
    round,
    ofRounds,
    rows,
  };
}
