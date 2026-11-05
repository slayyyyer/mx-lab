// LAP CHART sheet (`S1F1LAP.pdf` style).
//
// The PDF prints a grid: one row per finishing position, one column per lap, and
// the cell holds the *plate number* running in that position on that lap. A rider
// legend (plate and name, sorted by plate) sits in the left margin and is
// interleaved with the chart rows by `pdftotext -layout`, so the `#12 - J. Hill`
// at the start of a line is not the rider that row is about.
//
// Cells are 1–3 digits and each is centred under its lap number, but the header
// and the data rows do not share widths, so a fixed slice drifts after the first
// column. Each number is therefore matched to the nearest header centre, and a
// number that falls outside every column (the position index in the margin) is
// ignored. A blank cell is a null, never a zero.

const HEADER_RE = /^\s*1\s+2\s+3\s+4\s+5/;
const COLUMN_TOLERANCE = 4.5;

export function parseLapChart(text) {
  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => HEADER_RE.test(line));
  if (headerIndex < 0) throw new Error('lap chart: no lap header row');

  const header = lines[headerIndex];
  const columns = [];
  for (const match of header.matchAll(/(\d{1,2})(?=\s|$)/g)) {
    const lap = Number(match[1]);
    const expected = columns.length + 1;
    if (lap !== expected) continue;
    columns.push({ lap, center: match.index + (match[0].length - 1) / 2 });
  }
  if (columns.length < 5) throw new Error('lap chart: fewer than five lap columns');

  const firstCenter = columns[0].center;
  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!/^\s*#\d+\s*-/.test(line)) continue;

    const positionMatch = line.slice(0, Math.max(0, firstCenter - 2)).match(/(\d{1,2})\s*$/);
    if (!positionMatch) continue;
    const position = Number(positionMatch[1]);
    if (!Number.isInteger(position) || position < 1 || position > 60) continue;

    const plates = new Array(columns.length).fill(null);
    let matched = 0;
    for (const match of line.matchAll(/\d{1,3}/g)) {
      const center = match.index + (match[0].length - 1) / 2;
      if (center < firstCenter - 2) continue;
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < columns.length; i += 1) {
        const distance = Math.abs(columns[i].center - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      if (best < 0 || bestDistance > COLUMN_TOLERANCE) continue;
      if (plates[best] !== null) continue;
      plates[best] = Number(match[0]);
      matched += 1;
    }
    if (matched === 0) continue;
    rows.push({ position, plates });
  }
  if (rows.length === 0) throw new Error('lap chart: no position rows');

  const byPlate = new Map();
  const warnings = [];
  for (let column = 0; column < columns.length; column += 1) {
    const seen = new Set();
    for (const row of rows) {
      const plate = row.plates[column];
      if (plate === null) continue;
      if (seen.has(plate)) {
        warnings.push(`lap ${column + 1}: plate ${plate} appears in two positions`);
        continue;
      }
      seen.add(plate);
      if (!byPlate.has(plate)) byPlate.set(plate, new Array(columns.length).fill(null));
      byPlate.get(plate)[column] = row.position;
    }
  }

  return { laps: columns.length, byPlate, rows: rows.length, warnings };
}
