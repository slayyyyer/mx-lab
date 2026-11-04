// Ingest one 2025/2026 event from `results.promotocross.com`.
//
// The AMA adapter reads PDFs and merges two sheets per moto; this one reads one
// page per moto that already carries both the result row and the rider's own lap
// table. Both end in `finalizeEvent`, so the dataset shape is identical — the
// only difference is that a LiveTime lap can carry a `position`.

import { loadOverrides, riderId } from './identity.js';
import { fetchBytes } from './lib/http.js';
import { finalizeEvent } from './build.js';
import { parseMotoReport, parseQualifyingReport } from './parse/lt.js';
import { hubUrl, parseEventHub } from './sources/promotocross.js';

/** `M1F1` is 450 Moto 1 and `M2F1` is 250 Moto 1, matching the PDF era's ids. */
export function sessionIdFor(className, moto) {
  return `${className === '250MX' ? 'M2' : 'M1'}F${moto}`;
}

export function datasetId(year, round) {
  return `LT${String(year).slice(2)}${String(round).padStart(2, '0')}`;
}

/**
 * `HAIDEN DEEGAN` → `Haiden Deegan`. Initials of three characters or fewer stay
 * upper case (`RJ HAMPSHIRE` → `RJ Hampshire`) because the source prints them
 * that way and lowering them would invent a different name.
 */
export function displayName(raw) {
  return String(raw ?? '')
    .trim()
    // The results table appends ` Holeshot` to whoever took it, which would turn
    // one rider into two identities across a season (`haiden-deegan` and
    // `haiden-deegan-holeshot`). It is an annotation, not part of the name.
    .replace(/\s+holeshot\s*$/i, '')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => {
      if (part.length <= 3 && /^[A-Z.]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

async function fetchHtml(url, offline) {
  const { bytes, meta } = await fetchBytes(url, { offline });
  return { html: bytes.toString('utf8'), meta };
}

/**
 * @param {object} input
 * @param {string} input.siteEventId  LiveTime event id, from the archive index
 * @param {number} input.year
 * @param {number} input.round
 * @param {number} input.ofRounds
 * @param {string} input.name         e.g. `Ironman - Crawfordsville, IN`
 * @param {string} input.date         ISO date from the index row
 */
export async function collectLtEvent({ siteEventId, year, round, ofRounds, name, date, offline = false }) {
  const hub = await fetchHtml(hubUrl(siteEventId), offline);
  const { reports } = parseEventHub(hub.html);

  const motoReports = reports
    .filter((report) => report.kind === 'moto')
    .sort((a, b) => (a.class === b.class ? a.moto - b.moto : a.class.localeCompare(b.class)));
  if (motoReports.length === 0) throw new Error(`lt ${siteEventId}: no moto reports linked from the event page`);

  const sources = [{ url: hubUrl(siteEventId), sha256: hub.meta.sha256 }];
  const parsedMotos = [];
  for (const report of motoReports) {
    const page = await fetchHtml(report.url, offline);
    sources.push({ url: report.url, sha256: page.meta.sha256 });
    parsedMotos.push(parseMotoReport(page.html, report));
  }

  const overrides = await loadOverrides();
  const qualifying = [];
  for (const report of reports.filter((entry) => entry.kind === 'qualifying')) {
    const page = await fetchHtml(report.url, offline);
    sources.push({ url: report.url, sha256: page.meta.sha256 });
    const parsed = parseQualifyingReport(page.html, report);
    qualifying.push({
      class: report.className,
      session: `${report.className.replace('MX', '')}QCOVR`,
      rows: parsed.rows.map((row) => ({
        ...row,
        name: displayName(row.name),
        riderId: riderId(displayName(row.name), overrides),
      })),
    });
  }

  const warnings = [];

  const motos = parsedMotos.map((moto) => ({
    class: moto.class,
    moto: moto.moto,
    session: sessionIdFor(moto.class, moto.moto),
    results: moto.riders.map((rider) => {
      const name = displayName(rider.name);
      return {
        pos: rider.pos,
        plate: rider.plate,
        riderId: riderId(name, overrides),
        name,
        hometown: rider.hometown,
        bike: rider.bike,
        team: rider.team,
        status: rider.status,
        gapMs: rider.gapMs,
        lapsCompleted: rider.lapsCompleted,
        bestLapMs: rider.bestLapMs,
        laps: rider.laps.map((lap) => ({
          lap: lap.lap,
          timeMs: lap.timeMs,
          position: lap.position,
        })),
      };
    }),
  }));

  for (const moto of parsedMotos) warnings.push(...moto.warnings);

  const [track, location] = String(name ?? '').split(/\s+-\s+/);

  return finalizeEvent({
    event: {
      id: datasetId(year, round),
      series: 'AMA Pro Motocross',
      name: name ?? null,
      track: track ?? null,
      location: location ?? null,
      date: date ?? null,
      round: round ?? null,
      ofRounds: ofRounds ?? null,
    },
    motos,
    qualifying,
    sources,
    warnings,
  });
}
