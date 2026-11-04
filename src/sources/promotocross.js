// Discovery for `results.promotocross.com` (LiveTime), seasons 2025–2026.
//
// Nothing here builds a report URL from parts: the event hub is the only thing
// that knows which reports exist, and its anchor text is the only thing that
// says what they are. Guessing `p=` values returns 404 (ADR 0003).

export const LT_BASE = 'https://results.promotocross.com';
export const EVENT_INDEX_URL = `${LT_BASE}/events/`;

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function hubUrl(siteEventId) {
  return `${LT_BASE}/results/?p=view_event&id=${siteEventId}`;
}

function text(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Aug 29, 2026` → `2026-08-29`; `Aug 22, 2025 to Aug 23, 2025` uses the first day. */
export function parseIndexDate(textValue) {
  const match = String(textValue ?? '').match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

/**
 * The `/events/` index: one row per event with a date, across every season the
 * archive carries. Side events (WMX, Moto Combine) are listed here too and are
 * filtered by the caller, not dropped silently here.
 *
 * @returns {Array<{siteId: string, name: string, dateText: string, date: string|null, year: number|null}>}
 */
export function parseEventIndex(html) {
  const events = [];
  const seen = new Set();
  const rowRe =
    /<a[^>]*href="[^"]*p=view_event&(?:amp;)?id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (const match of String(html).matchAll(rowRe)) {
    const siteId = match[1];
    if (seen.has(siteId)) continue;
    seen.add(siteId);
    const dateText = text(match[3]);
    const date = parseIndexDate(dateText);
    events.push({
      siteId,
      name: text(match[2]),
      dateText,
      date,
      year: date ? Number(date.slice(0, 4)) : null,
    });
  }
  if (events.length === 0) throw new Error('lt index: no events found');
  return events;
}

/** Championship rounds only: the index also lists WMX and Moto Combine events. */
export function isChampionshipEvent(name) {
  return !/^(WMX|Moto Combine)\b/i.test(String(name ?? '').trim());
}

// Three label styles across two seasons, all the same report:
//   `250 Moto 1` (most 2025 rounds), `250 Class Moto 1` (2025 opener),
//   `250 Class Moto #1` (2026).
const MOTO_RE = /^(\d{3})\s+(?:Class\s+)?Moto\s+#?(\d)$/i;
const QUALIFYING_RE = /^(\d{3})\s+Combined Qualifying Results$/i;

/** Classify a report link label. Anything unrecognised is `other`, never guessed. */
export function classifyReport(label) {
  const clean = String(label ?? '').replace(/^(?:-->|\s)+/, '').trim();
  const moto = clean.match(MOTO_RE);
  if (moto) return { kind: 'moto', className: `${moto[1]}MX`, moto: Number(moto[2]) };
  const qualifying = clean.match(QUALIFYING_RE);
  if (qualifying) return { kind: 'qualifying', className: `${qualifying[1]}MX` };
  return { kind: 'other' };
}

/**
 * Reports linked from an event hub page.
 *
 * @returns {{name: string|null, reports: Array<object>}}
 */
export function parseEventHub(html) {
  const source = String(html);
  const name = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ? text(source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)[1])
    : null;

  const reports = [];
  const seen = new Set();
  const anchorRe = /<a[^>]*href="([^"]*p=(view_race_result|view_combined_round_ranking)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(anchorRe)) {
    const href = match[1];
    if (/export=pdf/.test(href)) continue;
    const label = text(match[3]);
    const classified = classifyReport(label);
    if (classified.kind === 'other') continue;
    const siteId = href.match(/[?&]id=(\d+)/)?.[1] ?? null;
    const classId = href.match(/[?&]class_id=(\d+)/)?.[1] ?? null;
    const key = `${classified.kind}:${classified.className}:${classified.moto ?? classId ?? siteId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reports.push({
      ...classified,
      label,
      siteId,
      classId,
      url: `${LT_BASE}${href}`,
    });
  }

  return { name, reports };
}
