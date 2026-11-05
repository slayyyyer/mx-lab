// OVERALL RESULTS sheet (`S1F1PRESS.pdf`), used by Triple Crown rounds.
//
// A Triple Crown round runs three short mains and classifies the round on the
// combined score, so there is no `...RES.pdf` for the class:
//
//   OVERALL RESULTS - 450SX OVERALL
//   POS.  #  RIDER  HOMETOWN  BIKE  M1  M2  M3  POINTS  TEAM/SPONSORS
//    1   23  Chase Sexton  Clermont, FL  Honda CRF450R  1  5  1  26  Team Honda HRC
//
// The POINTS column is the official award for the round (26 for a win, not the
// 25 of a single moto), so it is kept with the row instead of being recomputed.
// There are no lap times here: the per-moto sheets (`S1E1RID` …) are separate and
// are not merged into this classification.

import { splitCells } from '../lib/text.js';

export const OVERALL_PARSER_ID = 'ama/overall/triple-crown';

export function parseOverall(text) {
  const lines = String(text).replace(/\f/g, '\n').split(/\r?\n/);

  const titleIndex = lines.findIndex((line) => /OVERALL RESULTS\s*-\s*\d{3}SX\s*OVERALL/i.test(line));
  if (titleIndex < 0) throw new Error('overall: no title line');
  const className = lines[titleIndex].match(/(\d{3}SX)\s*OVERALL/i)[1];

  const roundMatch = lines.join('\n').match(/ROUND\s+(\d+)\s+OF\s+(\d+)/i);
  const headerIndex = lines.findIndex(
    (line, index) => index > titleIndex && /POS\./.test(line) && /RIDER/.test(line),
  );
  if (headerIndex < 0) throw new Error('overall: no column header');

  const rows = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const head = line.match(/^\s*(\d+)\s+(\d+[A-Za-z]?)\s+(.+)$/);
    if (!head) continue;

    const cells = splitCells(head[3]);
    if (cells.length < 4) continue;
    const [name, hometown] = cells;
    // A bike whose model ends in a number can be printed one space from the first
    // score (`Husqvarna FC 250 RE 1`), which merges them into one cell. Splitting
    // the trailing number back off is the difference between 21 and 22 rows.
    let bike = cells[2] ?? '';
    const merged = bike.match(/^(.+?)\s+(\d{1,2})$/);
    const carried = merged && /[A-Za-z]/.test(merged[1]) ? [Number(merged[2])] : [];
    if (carried.length > 0) bike = merged[1];
    const rest = [...carried, ...cells.slice(3)];

    const numeric = [];
    let index = 0;
    while (index < rest.length && /^\d+$/.test(rest[index])) {
      numeric.push(Number(rest[index]));
      index += 1;
    }
    // M1, M2, M3, POINTS — anything shorter is not a classified overall row.
    if (numeric.length < 4) continue;

    rows.push({
      pos: Number(head[1]),
      plate: Number(head[2].replace(/\D+/g, '')),
      name,
      hometown,
      bike,
      motos: numeric.slice(0, 3),
      points: numeric[3],
      team: rest.slice(index).join('  ') || null,
    });
  }

  if (rows.length === 0) throw new Error('overall: header found but no rows parsed');
  const positions = rows.map((row) => row.pos).sort((a, b) => a - b);
  if (positions[0] !== 1 || positions.some((pos, i) => i > 0 && pos !== positions[i - 1] + 1)) {
    throw new Error(`overall: positions are not contiguous 1..${rows.length}`);
  }

  return {
    parser: OVERALL_PARSER_ID,
    class: className,
    moto: 1,
    round: roundMatch ? Number(roundMatch[1]) : null,
    ofRounds: roundMatch ? Number(roundMatch[2]) : null,
    rows,
  };
}
