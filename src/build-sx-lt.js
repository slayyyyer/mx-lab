// Ingest one 2025/2026 Supercross event from `results.supercrosslive.com`.
//
// Same engine and same report parser as the Motocross adapter, but the 250 class
// is labelled without a coast at most rounds, so the coast is resolved before the
// class name is fixed: hub heat labels first, then the qualifying report's header.

import { loadOverrides, riderId } from './identity.js';
import { fetchBytes } from './lib/http.js';
import { finalizeEvent } from './build.js';
import { parseMotoReport, parseOverallReport, parseQualifyingReport } from './parse/lt.js';
import { coastForRound, hubUrl, parseEventHub } from './sources/supercross.js';
import { displayName } from './build-lt.js';

export function datasetId(year, round) {
  return `SL${String(year).slice(2)}${String(round).padStart(2, '0')}`;
}

async function fetchHtml(url, offline) {
  const { bytes, meta } = await fetchBytes(url, { offline });
  return { html: bytes.toString('utf8'), meta };
}

/** `250SX West` printed in a qualifying header is the fallback coast. */
export function coastFromQualifying(html) {
  const body = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const match = body.match(/250\s*SX\s*[-–]?\s*(East|West)\b/i);
  return match ? match[1].replace(/^e/i, 'E').replace(/^w/i, 'W') : null;
}

export async function collectSxLtEvent({ siteEventId, year, round, ofRounds, name, date, offline = false }) {
  const hub = await fetchHtml(hubUrl(siteEventId), offline);
  const parsedHub = parseEventHub(hub.html);
  const sources = [{ url: hubUrl(siteEventId), sha256: hub.meta.sha256 }];

  // Heat labels are authoritative; the published schedule fills the rounds that
  // print none (which is most of them).
  let coast = parsedHub.coast ?? coastForRound(year, round);
  const qualifying250 = parsedHub.reports.find(
    (report) => report.classified.kind === 'qualifying' && report.classified.classCode === 'S2',
  );
  if (!coast && qualifying250) {
    const page = await fetchHtml(qualifying250.url, offline);
    sources.push({ url: qualifying250.url, sha256: page.meta.sha256 });
    coast = coastFromQualifying(page.html);
    qualifying250.html = page.html;
  }

  const reports = parsedHub.reports.map((report) => ({ ...report, classified: report.classified }));
  for (const report of reports) {
    const base = report.classified;
    if (base.classCode !== 'S2' || !coast) continue;
    if (base.className === '250SX') {
      report.classified = { ...base, className: coast === 'Showdown' ? '250SX Showdown' : `250SX ${coast}` };
    }
  }

  const motoReports = reports
    .filter((report) => report.classified.kind === 'moto')
    .sort((a, b) => a.classified.className.localeCompare(b.classified.className));
  if (motoReports.length === 0) throw new Error(`sx lt ${siteEventId}: no main events linked from the event page`);

  const overrides = await loadOverrides();
  const parsedMotos = [];
  for (const report of motoReports) {
    const page = report.html ? { html: report.html, meta: { sha256: null } } : await fetchHtml(report.url, offline);
    if (!report.html) sources.push({ url: report.url, sha256: page.meta.sha256 });
    parsedMotos.push(
      report.classified.overall
        ? parseOverallReport(page.html, { className: report.classified.className })
        : parseMotoReport(page.html, { className: report.classified.className, moto: 1 }),
    );
  }

  const qualifying = [];
  for (const report of reports.filter((entry) => entry.classified.kind === 'qualifying')) {
    const page = report.html ? { html: report.html } : await fetchHtml(report.url, offline);
    if (!report.html) sources.push({ url: report.url, sha256: page.meta.sha256 });
    const parsed = parseQualifyingReport(page.html, { className: report.classified.className });
    qualifying.push({
      class: report.classified.className,
      session: `${report.classified.classCode}QCOVR`,
      rows: parsed.rows.map((row) => {
        const display = displayName(row.name);
        return { ...row, name: display, riderId: riderId(display, overrides) };
      }),
    });
  }

  const warnings = [];
  for (const moto of parsedMotos) warnings.push(...moto.warnings);

  const motos = parsedMotos.map((moto) => ({
    class: moto.class,
    moto: 1,
    session: `${moto.class.startsWith('450') ? 'S1' : 'S2'}F1`,
    results: moto.riders.map((rider) => {
      const display = displayName(rider.name);
      return {
        pos: rider.pos,
        plate: rider.plate,
        riderId: riderId(display, overrides),
        name: display,
        hometown: rider.hometown,
        bike: rider.bike,
        team: rider.team,
        status: rider.status,
        gapMs: rider.gapMs,
        lapsCompleted: rider.lapsCompleted,
        bestLapMs: rider.bestLapMs,
        laps: rider.laps.map((lap) => ({ lap: lap.lap, timeMs: lap.timeMs, position: lap.position })),
      };
    }),
  }));

  return finalizeEvent({
    event: {
      id: datasetId(year, round),
      series: 'AMA Supercross',
      name: name ?? null,
      track: name ?? null,
      location: null,
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
