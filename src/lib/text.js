// Text helpers shared by every parser.
//
// Times arrive as `m:ss.mmm` (moto laps, qualifying) and gaps as `+s.mmm` or
// `+m:ss.mmm`. Missing values are printed `--.---` and must become null, never 0:
// a missing lap time and a zero-second lap are different facts.

// Supercross prints a lap under a minute as `58.708` (no minutes), and rounded
// qualifying times with two decimals (`1:02.49`), so minutes are optional and
// the fraction is one to three digits. A missing fraction is still a time.
export const TIME_RE = /^(?:\d{1,2}:)?\d{1,3}\.\d{1,3}$/;
export const DASH_TIME = '--.---';

/** `2:23.895` -> 143895 (ms), `56.17` -> 56170. null for `--.---` and non-times. */
export function parseTime(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === DASH_TIME || !TIME_RE.test(text)) return null;
  const parts = text.split(':');
  const [seconds, fraction] = parts.pop().split('.');
  const minutes = parts.length > 0 ? Number(parts[0]) : 0;
  return minutes * 60000 + Number(seconds) * 1000 + Number(fraction.padEnd(3, '0'));
}

/** `+05.058` -> 5058, `+1:05.109` -> 65109. null when not a gap. */
export function parseGap(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const short = text.match(/^\+(\d{1,2})\.(\d{3})$/);
  if (short) return Number(short[1]) * 1000 + Number(short[2]);
  const long = text.match(/^\+(\d{1,3}):(\d{2})\.(\d{3})$/);
  if (long) return Number(long[1]) * 60000 + Number(long[2]) * 1000 + Number(long[3]);
  return null;
}

export function isTime(value) {
  return TIME_RE.test(String(value).trim());
}

/**
 * Split a `-layout` line on runs of 2+ spaces. pdftotext preserves horizontal
 * position as spaces, so this is the column separator the sheets are built on.
 * Single spaces are kept, because names, bikes and teams contain them.
 */
export function splitCells(line) {
  return line
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

/** Slice a line into fixed column windows. Used where a blank cell would otherwise shift every later column. */
export function sliceColumns(line, bounds) {
  const cells = [];
  for (let i = 0; i < bounds.length; i += 1) {
    const start = bounds[i];
    const end = i + 1 < bounds.length ? bounds[i + 1] : line.length;
    cells.push(line.slice(start, end).trim());
  }
  return cells;
}

/** Column windows from the x offsets of `#plate` headers: each window is centred between neighbours. */
export function boundsFromHeaders(headerLine) {
  const starts = [...headerLine.matchAll(/#\s*\d+/g)].map((match) => match.index);
  if (starts.length === 0) return null;
  const bounds = starts.map((start, i) => {
    if (i === 0) return 0;
    return Math.floor((starts[i - 1] + start) / 2);
  });
  return bounds;
}

export function parseInt0(value) {
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * Positions must be exactly 1..n. This is how a parser proves it read every row:
 * if one row wraps and fails to parse, the remaining positions have a hole.
 */
export function positionsContiguous(positions) {
  const sorted = [...positions].sort((a, b) => a - b);
  return sorted.every((pos, index) => pos === index + 1);
}
