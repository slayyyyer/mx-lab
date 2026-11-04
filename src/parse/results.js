// PROVISIONAL RESULTS sheet (`M1F1RES.pdf` style).
//
// Row shape, across the 2020–2024 layouts:
//   POS  #  RIDER  HOMETOWN  BIKE  INTERVAL  [BEST TIME]  [TEAM/SPONSORS]
// where INTERVAL is `18 Laps`, `+04.895`, `+1:44.995`, `DNF`, and the best-time
// and team columns are absent in 2023 and earlier.
//
// Hazards this parser is built around:
//   - The class comes from the title line, never the sheet code: M1F1 is 450
//     Moto 1, but M1F2 is 450 Moto 2 while M2F1 is 250 Moto 1.
//   - 2023 prints `MOTO 1`, 2024 prints `MOTO #1`.
//   - Whitespace is not a column separator. From 2020–2023 the bike and
//     interval are one space apart (`YAM YZ 250F +1:19.245`), and names collapse
//     into hometowns (`Nicholas Tomasunas Newaygo, MI`). So text columns are
//     sliced using the header's own x offsets, and only the interval is found by
//     token, because `18 Laps` / `+04.895` / `DNF` are unambiguous.
//   - A long row can wrap onto a continuation line (250 Moto 1 at Pala, #108):
//     the primary line is sliced, and any field left empty is taken from the
//     continuation at the same column offsets.
//   - The table ends at the session-notes block; a later page carries a
//     lap-leader table whose rows also begin `pos  plate`.
//   - A row that still cannot be parsed is refused loudly, and positions are
//     then required to be contiguous 1..n.

import { isTime, parseGap, parseTime, positionsContiguous, splitCells } from '../lib/text.js';

export const RESULTS_PARSER_ID = 'ama/results/layout-2020-2024';

const ROW_HEAD_RE = /^\s*(\d+)\s+(\d+)\s*(.*)$/;
const INTERVAL_TOKEN_RE = /(?:\d+\s+Laps|DNF|DNS|DSQ|DSNP|\+\d{1,3}:\d{2}\.\d{3}|\+\d{1,2}\.\d{3})/;

// The bike is the only free-text column with a closed vocabulary, and every
// layout prints it starting with the brand, so it can be anchored where column
// offsets fail. Longest alternative first, so `GASGAS` does not read as `GAS`.
const BIKE_HEAD_RE =
  /\b(?:Husqvarna|Kawasaki|Yamaha|Suzuki|GASGAS|Triumph|Honda|KTM|HQV|YAM|HON|KAW|SUZ|GAS|TM)\b/g;

function columnBounds(headerLine) {
  const bounds = {
    rider: headerLine.indexOf('RIDER'),
    hometown: headerLine.indexOf('HOMETOWN'),
    bike: headerLine.indexOf('BIKE'),
    interval: headerLine.indexOf('INTERVAL'),
  };
  const ordered =
    bounds.rider >= 0 &&
    bounds.hometown > bounds.rider &&
    bounds.bike > bounds.hometown &&
    bounds.interval > bounds.bike;
  if (!ordered) throw new Error('results: unrecognised column header layout');
  return bounds;
}

export function parseResults(text) {
  const lines = text.split(/\r?\n/);

  const titleIndex = lines.findIndex((line) => /RESULTS\s*-\s*\d{3}MX\s*MOTO\s*#?\s*\d/i.test(line));
  if (titleIndex < 0) throw new Error('results: no session title line');
  const title = lines[titleIndex].match(/(\d{3}MX)\s*MOTO\s*#?\s*(\d)/i);
  const className = title[1];
  const moto = Number(title[2]);

  const roundMatch = lines.join('\n').match(/ROUND\s+(\d+)\s+OF\s+(\d+)/i);
  const round = roundMatch ? Number(roundMatch[1]) : null;
  const ofRounds = roundMatch ? Number(roundMatch[2]) : null;

  const headerIndex = lines.findIndex((line) => /POS\./.test(line) && /RIDER/.test(line));
  if (headerIndex < 0) throw new Error('results: no column header');
  const bounds = columnBounds(lines[headerIndex]);

  const notesIndex = lines.findIndex(
    (line, index) => index > headerIndex && /SESSION NOTES|Humidity:|RACE TIME:/i.test(line),
  );
  const endIndex = notesIndex === -1 ? lines.length : notesIndex;

  // A field wider than its column overflows into the next one (a 24-character
  // name in a 22-character column), so each field reports where it actually
  // ended and the next field starts there instead of at its header offset. That
  // keeps an overflowing name from bleeding its tail into the hometown.
  const readField = (line, start, end) => {
    const from = Math.max(start, 0);
    const raw = line.slice(from, end);
    if (!raw.trim()) return { value: '', end: from };
    if (line[end - 1] === ' ') return { value: raw.trim(), end };
    const rest = line.slice(end);
    const gap = rest.search(/\s{2,}/);
    const consumed = gap === -1 ? rest.length : gap;
    return { value: `${raw}${rest.slice(0, consumed)}`.trim(), end: end + consumed };
  };

  const slice = (line) => {
    // A name that outgrows its column can be followed straight away by the rest of
    // the row (`#108 Jorgen-Matthias Talviku` then a continuation line), so the
    // field is allowed to run on. But when a hometown is printed on this same line
    // there is nothing to reassemble, and the name stops at its own column.
    // The test must not look at the hometown column itself: an overflowing name
    // spills into it. A printed bike column means the row is complete on this line.
    // The test must look past every column the name can spill into: a printed
    // interval (even `DNF`) means the row is complete on this line, and anything
    // after the interval column is enough to tell.
    const rowEndsHere = line.slice(bounds.interval ?? bounds.bike).trim() !== '';
    const nameField = readField(line, bounds.rider, bounds.hometown);
    const name = rowEndsHere
      ? line.slice(bounds.rider, bounds.hometown).trim() || nameField.value
      : nameField.value;

    const hometown = readField(line, bounds.hometown, bounds.bike);
    const bike = readField(line, Math.max(bounds.bike, hometown.end), bounds.interval);
    return { name, hometown: hometown.value, bike: bike.value };
  };

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
      current = { pos: Number(head[1]), plate: Number(head[2]), line, continuations: [], lineNumber: i + 1 };
      continue;
    }
    if (current) current.continuations.push(line);
  }
  if (current) logical.push(current);

  const rows = logical.map((entry) => {
    const primary = slice(entry.line);

    // A continuation line is not laid out on the row's columns: when a name
    // overflows, the rest of the row starts in the name's own column. So its
    // fields are read by whitespace, skipping value cells (interval, best time).
    const continuationFields = entry.continuations
      .flatMap((line) => splitCells(line))
      .filter((cell) => !INTERVAL_TOKEN_RE.test(cell) && !isTime(cell));

    const name = primary.name;
    // A name that outgrew its column leaves its tail in the next field's window
    // (`Jorgen-Matthias Talviku` ends with `u` in the hometown column). A value
    // that is just the end of the name is overflow, not a field.
    const notOverflow = (value) => (value && name.endsWith(value) ? '' : value);

    let hometown = notOverflow(primary.hometown) || continuationFields[0] || '';
    let bike = notOverflow(primary.bike) || continuationFields[1] || '';

    if (!/[A-Za-z]/.test(name)) {
      throw new Error(`results: unsupported layout at line ${entry.lineNumber}: no rider name in column 3`);
    }

    // Search from the bike column, not from the INTERVAL header offset: numeric
    // columns are right-aligned, so a long value such as `+1:05.273` starts
    // before the header label and slicing at the label clips its leading `+`.
    const region = [entry.line.slice(bounds.bike), ...entry.continuations.map((line) => line.slice(bounds.bike))].join(
      '   ',
    );
    const intervalMatch = region.match(INTERVAL_TOKEN_RE);
    if (!intervalMatch) {
      throw new Error(
        `results: unsupported layout at line ${entry.lineNumber}: no interval in column 6 (${entry.line.trim().slice(0, 70)})`,
      );
    }

    // A hometown that fills its column flush leaves one space before the bike
    // (`Landsborough, Australia Honda CRF450R WE`), so the hometown read swallows
    // the bike and the bike read then lands on the interval. Anchor the bike on its
    // brand instead; a tail with a comma is a hometown, not a bike.
    if (entry.continuations.length === 0) {
      const head = entry.line.slice(bounds.hometown, bounds.bike + intervalMatch.index);
      const brand = [...head.matchAll(BIKE_HEAD_RE)].at(-1);
      if (brand) {
        const tail = head.slice(brand.index).trim().replace(/\s+/g, ' ');
        if (tail && tail.length <= 24 && !tail.includes(',')) {
          bike = tail;
          hometown = head.slice(0, brand.index).trim().replace(/\s+/g, ' ') || hometown;
        }
      }
    }

    // Whatever the boundary did, an interval is never a bike.
    if (bike && INTERVAL_TOKEN_RE.test(bike)) bike = '';

    const intervalRaw = intervalMatch[0].replace(/\s+/g, ' ');
    const suffixCells = splitCells(region.slice(intervalMatch.index + intervalMatch[0].length));

    let lapsCompleted = null;
    let status = null;
    let gapMs = null;
    const laps = intervalRaw.match(/^(\d+) Laps$/);
    if (laps) {
      lapsCompleted = Number(laps[1]);
    } else if (/^(DNF|DNS|DSQ|DSNP)$/.test(intervalRaw)) {
      status = intervalRaw;
    } else {
      gapMs = parseGap(intervalRaw);
      if (gapMs === null) {
        throw new Error(`results: unparsable interval "${intervalRaw}" at line ${entry.lineNumber}`);
      }
    }

    let bestLapMs = null;
    let teamCellIndex = 0;
    if (isTime(suffixCells[0] ?? '')) {
      bestLapMs = parseTime(suffixCells[0]);
      teamCellIndex = 1;
    }
    const team = suffixCells.slice(teamCellIndex).join('  ');

    return {
      pos: entry.pos,
      plate: entry.plate,
      name,
      hometown,
      bike,
      lapsCompleted,
      status,
      gapMs,
      gapRaw: gapMs === null ? null : intervalRaw,
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
