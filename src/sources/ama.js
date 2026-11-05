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

export function manifestUrl(eventId, base = AMA_BASE, series = 'MX') {
  return `${base}/xml/${series}/events/${eventId}SchedRes.xml`;
}

export function sheetUrl(eventId, sessionId, kind, base = AMA_BASE, series = 'MX') {
  const suffix = {
    results: 'RES',
    'lap-times': 'RID',
    'segment-times': 'IND',
    'lap-chart': 'LAP',
    'qualifying-best-laps': 'OVR',
  }[kind];
  if (!suffix) throw new Error(`no URL suffix known for sheet kind ${kind}`);
  return `${base}/xml/${series}/events/${eventId}/${sessionId}${suffix}.pdf`;
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * `May 25, 2024` -> `2024-05-25`. Parsed explicitly, because Date() would make
 * it locale-dependent. Also accepts the archive's other two forms:
 * `SATURDAY, MAY 29, 2021` (weekday prefix) and `MAY 29-29, 2021` (day range).
 */
export function parseLongDate(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text
    .trim()
    .replace(/^[A-Za-z]+,\s*/, '')
    .replace(/(\d{1,2})-\d{1,2}/, '$1');
  const match = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

export function parseManifest(xml) {
  const eventMatch = xml.match(/<B\b([^>]*)>/);
  if (!eventMatch) throw new Error('manifest: no <B> event element');
  const attrs = parseAttrs(eventMatch[1]);

  // Manifests for 2020–2022 carry no SANC attribute; every session repeats the
  // event id in EID, which is the same value the newer manifests put in SANC.
  const sessionIdMatch = xml.match(/<F\b[^>]*\bEID="([^"]+)"/);
  // The first <C D="…"> is the weekday-explicit date (e.g. `SATURDAY, MAY 29,
  // 2021`), which is more precise than the <B> date range (`MAY 29-29, 2021`).
  const dayMatch = xml.match(/<C\b[^>]*\bD="([^"]+)"/);

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
    id: attrs.SANC ?? sessionIdMatch?.[1] ?? null,
    name: attrs.E ?? null,
    track: attrs.T ?? null,
    location: attrs.L ?? null,
    dateText: attrs.D ?? null,
    date: parseLongDate(dayMatch?.[1]) ?? parseLongDate(attrs.D),
    sessions,
  };
}

/**
 * 250SX runs two championships at once. The sheets print only `250SX`, but the
 * manifest lists the round's points sheet as `2EF1POINTS` or `2WF1POINTS`, which
 * names the coast racing that night. Both appear at an East/West showdown, and
 * then the coast of an individual rider is not in the data at all.
 */
export function coastFromManifest(manifest) {
  const paths = manifest.sessions.flatMap((session) => session.sheets.map((sheet) => sheet.path));
  const west = paths.some((path) => /2WF1POINTS\.pdf$/i.test(path));
  const east = paths.some((path) => /2EF1POINTS\.pdf$/i.test(path));
  if (west && east) return 'Showdown';
  if (west) return 'West';
  if (east) return 'East';
  return null;
}

const MX_CLASSES = { M1: '450MX', M2: '250MX' };

/** Sessions we treat as championship motos, keyed by the archive's own class code. */
export function motoSessions(manifest, series = 'MX') {
  if (series === 'SX') {
    const coast = coastFromManifest(manifest);
    return manifest.sessions
      .filter((session) => session.type === 'F' && /^S[12]F1$/.test(session.id))
      .map((session) => ({
        id: session.id,
        className:
          session.classCode === 'S1' ? '450SX' : coast ? `250SX ${coast}` : '250SX',
        moto: 1,
        classCode: session.classCode,
      }));
  }
  return manifest.sessions
    .filter((session) => session.type === 'F' && /^M[12]F\d$/.test(session.id))
    .map((session) => ({
      id: session.id,
      className: session.classCode === 'M1' ? '450MX' : '250MX',
      moto: Number(session.id.slice(3)),
      classCode: session.classCode,
    }));
}

// The combined qualifying sheet is not its own session: it is one of the sheets
// listed on the last qualifying session of the class (M1Q4 / M2Q4) and its
// filename carries the class. So it is discovered from the sheet list, not from
// a session id.
export function qualifyingSessions(manifest, series = 'MX') {
  const coast = series === 'SX' ? coastFromManifest(manifest) : null;
  const classes = series === 'SX' ? { S1: '450SX', S2: coast ? `250SX ${coast}` : '250SX' } : MX_CLASSES;
  const found = new Map();
  for (const session of manifest.sessions) {
    const className = classes[session.classCode];
    if (!className) continue;
    for (const sheet of session.sheets) {
      if (sheet.kind === 'qualifying-best-laps' && /QCOVR\.pdf$/i.test(sheet.path)) {
        found.set(className, {
          className,
          classCode: session.classCode,
          session: sheet.path.split('/').pop().replace(/\.pdf$/i, ''),
          path: sheet.path,
          declaredBy: session.id,
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.className.localeCompare(b.className));
}

// Kept for symmetry with the parsers' imports; results parsing uses cells, not regexes.
export { splitCells };
