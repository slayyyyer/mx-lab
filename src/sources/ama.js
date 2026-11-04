// The AMA archive's XML is a schedule + file manifest, not a result set
// (ADR 0001). It is still the right discovery layer: it tells us which sheets
// exist for a session, so we never guess a filename.

import { splitCells } from '../lib/text.js';

export const AMA_BASE = 'https://americanmotocrossresults.com';

// Longest suffixes first: M1F1POINTSPOSITION also ends with POINTS.
const FILE_KINDS = [
  ['POINTSPOSITION', 'points-position'],
  ['MANUFACTURERPOINTS', 'manufacturer-points'],
  ['SMXPOINTSPOSITION', 'smx-points-position'],
  ['SMXPOINTS', 'smx-points'],
  ['LINEUP', 'lineup'],
  ['PRESS', 'official-results'],
  ['POINTS', 'points'],
  ['OVR', 'qualifying-best-laps'],
  ['SEG', 'fastest-segments'],
  ['RID', 'lap-times'],
  ['IND', 'segment-times'],
  ['LAP', 'lap-chart'],
  ['RES', 'results'],
];

export function parseAttrs(fragment) {
  const attrs = {};
  for (const match of fragment.matchAll(/([A-Za-z]+)="([^"]*)"/g)) attrs[match[1]] = match[2];
  return attrs;
}

export function sheetKind(filePath) {
  const name = filePath.split('/').pop().replace(/\.pdf$/i, '').toUpperCase();
  for (const [suffix, kind] of FILE_KINDS) {
    if (name.endsWith(suffix)) return kind;
  }
  return 'unknown';
}

export function manifestUrl(eventId, base = AMA_BASE) {
  return `${base}/xml/MX/events/${eventId}SchedRes.xml`;
}

export function sheetUrl(eventId, sessionId, kind, base = AMA_BASE) {
  const suffix = {
    results: 'RES',
    'lap-times': 'RID',
    'segment-times': 'IND',
    'lap-chart': 'LAP',
    'qualifying-best-laps': 'OVR',
  }[kind];
  if (!suffix) throw new Error(`no URL suffix known for sheet kind ${kind}`);
  return `${base}/xml/MX/events/${eventId}/${sessionId}${suffix}.pdf`;
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** `May 25, 2024` -> `2024-05-25`. Parsed explicitly, because Date() would make it locale-dependent. */
export function parseLongDate(text) {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

export function parseManifest(xml) {
  const eventMatch = xml.match(/<B\b([^>]*)>/);
  if (!eventMatch) throw new Error('manifest: no <B> event element');
  const attrs = parseAttrs(eventMatch[1]);

  const sessions = [];
  // A session is <F ...> with <R/> children, or a self-closing <F ... />.
  for (const match of xml.matchAll(/<F\b([^>]*?)(?:\/>|>([\s\S]*?)<\/F>)/g)) {
    const sessionAttrs = parseAttrs(match[1]);
    if (!sessionAttrs.SID || sessionAttrs.SID === '0') continue;
    const sheets = [...(match[2] ?? '').matchAll(/<R\b([^>]*)\/>/g)].map((sheet) => {
      const sheetAttrs = parseAttrs(sheet[1]);
      return {
        kind: sheetKind(sheetAttrs.L ?? ''),
        name: sheetAttrs.FN ?? '',
        path: sheetAttrs.L ?? '',
      };
    });
    sessions.push({
      id: sessionAttrs.SID,
      classCode: sessionAttrs.CLS ?? null,
      className: sessionAttrs.CLSNAME ?? null,
      type: sessionAttrs.TYPE ?? null,
      startsAt: sessionAttrs.T ?? null,
      title: sessionAttrs.S ?? '',
      sheets,
    });
  }

  return {
    id: attrs.SANC ?? null,
    name: attrs.E ?? null,
    track: attrs.T ?? null,
    location: attrs.L ?? null,
    dateText: attrs.D ?? null,
    date: parseLongDate(attrs.D),
    sessions,
  };
}

/** Sessions we treat as championship motos, keyed by the archive's own class code. */
export function motoSessions(manifest) {
  return manifest.sessions
    .filter((session) => session.type === 'F' && /^M[12]F\d$/.test(session.id))
    .map((session) => ({
      id: session.id,
      className: session.classCode === 'M1' ? '450MX' : '250MX',
      moto: Number(session.id.slice(3)),
    }));
}

// The combined qualifying sheet is not its own session: it is one of the sheets
// listed on the last qualifying session of the class (M1Q4 / M2Q4) and its
// filename carries the class. So it is discovered from the sheet list, not from
// a session id.
export function qualifyingSessions(manifest) {
  const found = new Map();
  for (const session of manifest.sessions) {
    const className = session.classCode === 'M1' ? '450MX' : session.classCode === 'M2' ? '250MX' : null;
    if (!className) continue;
    for (const sheet of session.sheets) {
      if (sheet.kind === 'qualifying-best-laps' && /QCOVR\.pdf$/i.test(sheet.path)) {
        found.set(className, { className, path: sheet.path, declaredBy: session.id });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.className.localeCompare(b.className));
}

// Kept for symmetry with the parsers' imports; results parsing uses cells, not regexes.
export { splitCells };
