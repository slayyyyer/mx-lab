// OVERALL BEST LAP TIMES - QUALIFYING COMBINED (`M1QCOVR.pdf` style).
//
//   POS.  #  NAME  BIKE  BEST TIME  SES #1 .. SES #8
//
// Only some session columns are populated; the rest print `--.---`. The
// published BEST TIME must equal the fastest session, which is exactly the kind
// of internal consistency the validation gate checks.

import { isTime, parseTime, splitCells } from '../lib/text.js';

export const QUALIFYING_PARSER_ID = 'ama/qualifying/layout-2024';

export function parseQualifying(text) {
  // Page breaks split a row's leading whitespace from the row itself, so a
  // sheet with several pages loses its first line per page if `\f` is kept.
  const lines = text.replace(/\f/g, '\n').split(/\r?\n/);

  const titleIndex = lines.findIndex((line) => /OVERALL BEST LAP TIMES/i.test(line));
  if (titleIndex < 0) throw new Error('qualifying: no title line');

  const classLine = lines
    .slice(0, titleIndex)
    .map((line) => line.trim())
    .find((line) => /^\d{3}(?:MX|SX)$/.test(line));
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
    // A 250SX rider's plate carries the coast in qualifying (`1W`, `24E`); the
    // number is the identity, the letter is not part of it.
    const head = line.match(/^\s*(\d+)\s+(\d+[A-Za-z]?)\s+(.+)$/);
    if (!head) continue;

    const pos = Number(head[1]);
    const plate = Number(head[2].replace(/\D+/g, ''));
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
  // Some sheets award the same position to riders on identical times, so a
  // repeated position is a tie, not a gap. A jump still means a row was missed.
  const ordered = rows.map((row) => row.pos).sort((a, b) => a - b);
  const noGaps =
    ordered[0] === 1 &&
    ordered.every(
      (pos, index) => index === 0 || pos === ordered[index - 1] || pos === ordered[index - 1] + 1,
    );
  if (!noGaps) {
    throw new Error(`qualifying: positions skip a place in 1..${rows.length}; a row likely wrapped (unsupported layout)`);
  }

  return { parser: QUALIFYING_PARSER_ID, class: className, rows };
}
