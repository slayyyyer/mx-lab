// Discovery for `results.supercrosslive.com` (LiveTime), the 2025–2026 Supercross
// seasons. It is the same application as `results.promotocross.com`, so the hub
// is still the only thing that knows which reports exist — but the labels are
// different and the 250 class changes championship from round to round.

export const SX_LT_BASE = 'https://results.supercrosslive.com';
export const SX_EVENT_INDEX_URL = `${SX_LT_BASE}/events/`;

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function hubUrl(siteEventId) {
  return `${SX_LT_BASE}/results/?p=view_event&id=${siteEventId}`;
}

function text(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `May 9, 2026` → `2026-05-09`. */
export function parseIndexDate(value) {
  const match = String(value ?? '').match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

/**
 * The `/events/` index, one row per event. Both 2025 and 2026 are complete.
 *
 * @returns {Array<{siteId: string, name: string, date: string|null, year: number|null}>}
 */
export function parseEventIndex(html) {
  const events = [];
  const seen = new Set();
  for (const row of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1];
    const siteId = body.match(/p=view_event&(?:amp;)?id=(\d+)/)?.[1];
    if (!siteId || seen.has(siteId)) continue;
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => text(cell[1]));
    const name = cells[0];
    const date = parseIndexDate(cells[1]);
    if (!name || !date) continue;
    seen.add(siteId);
    events.push({ siteId, name, date, year: Number(date.slice(0, 4)) });
  }
  if (events.length === 0) throw new Error('sx index: no events found');
  return events;
}

/**
 * Which 250 championship a round belongs to, from the hub's own heat labels:
 * both coasts race at a showdown, one coast races everywhere else.
 */
export function coastFromLabels(labels) {
  const east = labels.some((label) => /^250 East Heat$/i.test(label));
  const west = labels.some((label) => /^250 West Heat$/i.test(label));
  if (east && west) return 'Showdown';
  if (east) return 'East';
  if (west) return 'West';
  return null;
}

// The 250 class is the one field this site does not print on ordinary rounds: the
// hub says `250 Main Event` and the qualifying report says nothing at all, while
// only showdowns and some late-season rounds label the heats by coast. These are
// the published coast assignments, round by round, from the 2025 and 2026 season
// schedules (Wikipedia schedule tables, whose dates and venues match this
// archive's own index). Hub heat labels still win when they exist.
const COAST_BY_ROUND = {
  2025: ['W', 'W', 'W', 'W', 'E', 'E', 'W', 'E', 'S', 'E', 'W', 'E', 'S', 'E', 'E', 'W', 'S'],
  2026: ['W', 'W', 'W', 'W', 'W', 'W', 'E', 'E', 'E', 'S', 'E', 'S', 'E', 'E', 'E', 'W', 'S'],
};

const COAST_CODES = { W: 'West', E: 'East', S: 'Showdown' };

export function coastForRound(year, round) {
  const codes = COAST_BY_ROUND[year];
  if (!codes || !Number.isInteger(round)) return null;
  return COAST_CODES[codes[round - 1]] ?? null;
}

// `450 Main Event` on most rounds, `450 Main` at Tampa 2025.
const MAIN_RE = /^(\d{3})(?:SX)?\s+Main(?:\s+Event)?$/i;
// Three spellings across the two seasons: `Dave Coombs Sr. 250 East West
// Showdown` (2025 Salt Lake City) and `250 East/West Showdown Main Event`.
const SHOWDOWN_RE = /^(?:Dave Coombs Sr\.\s*)?250\b.*\bShowdown\b.*$/i;
const QUALIFYING_RE = /^(\d{3}) Combined Qualifying Results$/i;

/** Classify one hub link. Anything unrecognised stays `other` rather than guessed. */
export function classifyReport(label, coast) {
  const clean = text(label);
  if (MAIN_RE.test(clean)) {
    const size = clean.match(MAIN_RE)[1];
    if (size === '450') return { kind: 'moto', className: '450SX', moto: 1, classCode: 'S1' };
    const className = coast && coast !== 'Showdown' ? `250SX ${coast}` : coast === 'Showdown' ? '250SX Showdown' : '250SX';
    return { kind: 'moto', className, moto: 1, classCode: 'S2' };
  }
  if (SHOWDOWN_RE.test(clean)) {
    return { kind: 'moto', className: '250SX Showdown', moto: 1, classCode: 'S2' };
  }
  const overall = clean.match(/^(\d{3}) Overall Results$/i);
  if (overall) {
    const size = overall[1];
    if (size === '450') return { kind: 'moto', className: '450SX', moto: 1, classCode: 'S1', overall: true };
    const className = coast && coast !== 'Showdown' ? `250SX ${coast}` : coast === 'Showdown' ? '250SX Showdown' : '250SX';
    return { kind: 'moto', className, moto: 1, classCode: 'S2', overall: true };
  }
  const qualifying = clean.match(QUALIFYING_RE);
  if (qualifying) {
    const size = qualifying[1];
    if (size === '450') return { kind: 'qualifying', className: '450SX', classCode: 'S1' };
    const className = coast && coast !== 'Showdown' ? `250SX ${coast}` : coast === 'Showdown' ? '250SX Showdown' : '250SX';
    return { kind: 'qualifying', className, classCode: 'S2' };
  }
  return { kind: 'other' };
}

export function parseEventHub(html) {
  const source = String(html);
  const reports = [];
  const labels = [];
  const seen = new Set();
  for (const match of source.matchAll(
    /href="([^"]*p=(view_race_result|view_combined_round_ranking|view_multi_main_result)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1];
    if (/export=pdf/.test(href)) continue;
    const label = text(match[3]);
    if (!label) continue;
    labels.push(label);
    if (seen.has(label)) continue;
    seen.add(label);
    reports.push({
      label,
      url: `${SX_LT_BASE}${href.replace(/&amp;/g, '&')}`,
      classified: classifyReport(label, coastFromLabels(labels)),
    });
  }

  const coast = coastFromLabels(labels);
  for (const report of reports) report.classified = classifyReport(report.label, coast);

  return { name: null, reports, labels, coast };
}
