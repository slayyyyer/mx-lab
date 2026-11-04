// OVERALL BEST LAP TIMES - QUALIFYING COMBINED (`M1QCOVR.pdf` style).
//
//   POS.  #  NAME  BIKE  BEST TIME  SES #1 .. SES #8
//
// Only some session columns are populated; the rest print `--.---`. The
// published BEST TIME must equal the fastest session, which is exactly the kind
// of internal consistency the validation gate checks.

import { isTime, parseTime, positionsContiguous, splitCells } from '../lib/text.js';

export const QUALIFYING_PARSER_ID = 'ama/qualifying/layout-2024';

export function parseQualifying(text) {
  const lines = text.split(/\r?\n/);

  const titleIndex = lines.findIndex((line) => /OVERALL BEST LAP TIMES/i.test(line));
  if (titleIndex < 0) throw new Error('qualifying: no title line');

  const classLine = lines.slice(0, titleIndex).map((line) => line.trim()).find((line) => /^\d{3}MX$/.test(line));
  const className = classLine ?? null;

  const headerIndex = lines.findIndex((line, index) => index > titleIndex && /POS\./.test(line) && /NAME/.test(line));
  if (headerIndex < 0) throw new Error('qualifying: no column header');

  const rows = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;

    // A two- or three-digit plate can sit one space from the name (`96 Hunter
    // Lawrence`), so the position and plate are matched and the rest is split.
    // The sheet is printed in two parts separated by `TOP 36 RIDERS QUALIFY`,
    // so this must not stop at the first non-row line. Contiguity is checked
    // afterwards instead.
    const head = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!head) continue;

    const pos = Number(head[1]);
    const plate = Number(head[2]);
    const cells = splitCells(head[3]);

    const name = cells[0] ?? '';
    if (!/[A-Za-z]/.test(name)) {
      throw new Error(`qualifying: unsupported layout at line ${i + 1} (${line.trim().slice(0, 60)})`);
    }

    const bike = cells[1] ?? '';
    const times = cells.slice(2).map((cell) => (isTime(cell) ? parseTime(cell) : null));
    const bestMs = times[0] ?? null;
    const sessions = times.slice(1);

    rows.push({ pos, plate, name, bike, bestMs, sessions });
  }

  if (rows.length === 0) throw new Error('qualifying: header found but no rows parsed');
  if (!positionsContiguous(rows.map((row) => row.pos))) {
    throw new Error(`qualifying: positions are not contiguous 1..${rows.length}; a row likely wrapped (unsupported layout)`);
  }

  return { parser: QUALIFYING_PARSER_ID, class: className, rows };
}
