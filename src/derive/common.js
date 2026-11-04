// Shared arithmetic for the analyses.
//
// Everything here is pure and order-stable: the derived files are committed, so
// a re-run must produce identical bytes. Two rules follow from that:
//
//   - every list is sorted on an explicit key before it is written;
//   - every float is rounded through `round()` so the JSON never carries a
//     platform-dependent last digit, and `-0` never appears.

/**
 * AMA Pro Motocross moto points for 1st through 20th. The dataset records
 * finishing positions but not points, so the standings are computed from this
 * table rather than read from the source — the site says so.
 */
export const POINTS_TABLE = [
  25, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];

/** Points for a finishing position. Anything outside 1–20 scores nothing. */
export function pointsFor(pos) {
  if (!Number.isInteger(pos) || pos < 1 || pos > POINTS_TABLE.length) return 0;
  return POINTS_TABLE[pos - 1];
}

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function median(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

/** Deterministic rounding: two decimals by default, and never `-0`. */
export function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Average ranks, 1-based, so ties share the rank they span. */
export function ranks(values) {
  const order = values.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

/**
 * Spearman rank correlation. Rank-based because both sides are orderings, not
 * measurements: a 4.2 s lap-1 gap and a four-place drop are not on one scale.
 * Returns null when either side has no variation, which is a real case — a moto
 * where every rider's lap 1 is missing has no correlation to report.
 */
export function spearman(pairs) {
  if (pairs.length < 3) return null;
  const xs = ranks(pairs.map((pair) => pair[0]));
  const ys = ranks(pairs.map((pair) => pair[1]));
  const mx = mean(xs);
  const my = mean(ys);
  let numerator = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    numerator += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return numerator / Math.sqrt(dx * dy);
}

export function seasonOf(event) {
  return Number(String(event.event.date).slice(0, 4));
}

/** Chronological: date, then event id so two events on one day never reorder. */
export function sortedEvents(events) {
  return [...events].sort(
    (a, b) => cmp(a.event.date ?? '', b.event.date ?? '') || cmp(a.event.id, b.event.id),
  );
}

/** Moto order is class then moto number: 250 Moto 1, 250 Moto 2, 450 Moto 1, … */
export function sortedMotos(event) {
  return [...event.motos].sort((a, b) => cmp(a.class, b.class) || a.moto - b.moto);
}

export function sortRiders(rows) {
  return [...rows].sort((a, b) => cmp(a.riderId, b.riderId));
}

/** `2024-06-01` -> `2024-06-01`; a missing date is `null`, never `''`. */
export function eventDate(event) {
  return event.event.date ?? null;
}
