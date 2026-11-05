// Build one event's dataset.
//
// `assembleEvent` is pure: it takes already-extracted sheet text and returns the
// dataset object, so tests exercise the exact code the build runs. `main` is the
// only part that touches the network, and it never writes a dataset that fails
// the gate.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { stableStringify } from './lib/json.js';
import { fetchBytes, fetchPdf } from './lib/http.js';
import { pdfToText } from './lib/poppler.js';
import { riderId, loadOverrides } from './identity.js';
import { parseLapChart } from './parse/lapChart.js';
import { parseLapTimes } from './parse/lapTimes.js';
import { parseOverall } from './parse/overall.js';
import { parseQualifying } from './parse/qualifying.js';
import { parseResults } from './parse/results.js';
import {
  AMA_BASE,
  manifestUrl,
  motoSessions,
  parseManifest,
  qualifyingSessions,
} from './sources/ama.js';
import { validateEvent } from './validate.js';

export const SCHEMA_VERSION = 2;

/**
 * The single place the dataset shape is defined, shared by the PDF adapter and
 * the LiveTime adapter so the two eras cannot drift apart.
 */
export function finalizeEvent({ event, motos, qualifying = [], sources = [], warnings = [] }) {
  const sortedMotos = [...motos].sort((a, b) =>
    a.class === b.class ? a.moto - b.moto : a.class.localeCompare(b.class),
  );
  return {
    schema: SCHEMA_VERSION,
    event: {
      id: event.id,
      series: event.series ?? 'AMA Pro Motocross',
      name: event.name ?? null,
      track: event.track ?? null,
      location: event.location ?? null,
      date: event.date ?? null,
      round: event.round ?? null,
      ofRounds: event.ofRounds ?? null,
    },
    motos: sortedMotos,
    qualifying: [...qualifying].sort((a, b) => a.class.localeCompare(b.class)),
    sources: [...sources].sort((a, b) => a.url.localeCompare(b.url)),
    warnings: [...new Set(warnings)].sort(),
  };
}

/**
 * @param {object} input
 * @param {object} input.event   id, name, track, location, date, round, ofRounds, series
 * @param {Array}  input.motos   { class, moto, session, resultsText, lapTimesText, qualifyingText }
 * @param {Array}  input.sources [{ url, sha256 }]
 * @param {object} input.overrides
 */
export function assembleEvent({ event, motos, sources = [], overrides = {} }) {
  const warnings = [];
  const builtMotos = [];
  const qualifyingByKey = new Map();

  for (const moto of motos) {
    // A Triple Crown round prints three mains and one OVERALL classification; the
    // overall is the round's finishing order and carries the official points.
    let overallUsed = false;
    let parsedResults = null;
    if (moto.overallText) {
      try {
        parsedResults = parseOverall(moto.overallText);
        overallUsed = true;
      } catch (error) {
        if (!moto.resultsText) throw error;
        warnings.push(`${moto.session}: overall sheet unusable (${error.message}); using the main-event result sheet`);
      }
    }
    parsedResults ??= parseResults(moto.resultsText);
    // A Supercross 250 class carries its coast in the class name (`250SX West`)
    // while the sheet prints only `250SX`, so the comparison is on the base class.
    if (!moto.class.startsWith(parsedResults.class)) {
      throw new Error(`moto ${moto.session}: title says ${parsedResults.class}, manifest says ${moto.class}`);
    }
    if (!overallUsed && parsedResults.moto !== moto.moto) {
      throw new Error(`moto ${moto.session}: title says moto ${parsedResults.moto}, manifest says ${moto.moto}`);
    }

    // A lap sheet that cannot be read must not discard a round's results: the
    // finishing order is the primary record. The failure is recorded as a
    // warning on the event, so coverage still shows the gap.
    let parsedLaps = { riders: [], warnings: [] };
    if (moto.lapTimesText && !overallUsed) {
      try {
        parsedLaps = parseLapTimes(moto.lapTimesText);
      } catch (error) {
        warnings.push(`${moto.session}: lap times sheet not parsed (${error.message}); results kept without lap times`);
      }
    }
    warnings.push(...(parsedLaps.warnings ?? []));
    const lapsByPlate = new Map(parsedLaps.riders.map((rider) => [rider.plate, rider]));

    const results = parsedResults.rows.map((row) => {
      const lapTimes = lapsByPlate.get(row.plate);
      if (!lapTimes && !overallUsed) {
        warnings.push(`${moto.session} #${row.plate}: no entry on the individual lap times sheet`);
      }
      lapsByPlate.delete(row.plate);
      return {
        pos: row.pos,
        plate: row.plate,
        riderId: riderId(row.name, overrides),
        name: row.name,
        hometown: row.hometown,
        bike: row.bike,
        team: row.team,
        status: row.status ?? null,
        gapMs: row.gapMs ?? null,
        lapsCompleted: row.lapsCompleted ?? null,
        bestLapMs: row.bestLapMs ?? null,
        // Official points where the sheet prints them (Triple Crown overall);
        // otherwise the derived table is used.
        points: row.points ?? null,
        laps: lapTimes?.laps ?? [],
      };
    });

    for (const leftover of lapsByPlate.keys()) {
      warnings.push(`${moto.session}: #${leftover} has lap times but no result row`);
    }

    // The LAP CHART sheet is the only per-lap position in 2020–2024. It is keyed
    // by plate and printed as a position-by-lap grid, so it is attached after the
    // result rows exist and never invents a position for a plate it omits.
    let chart = null;
    if (moto.lapChartText) {
      try {
        chart = parseLapChart(moto.lapChartText);
      } catch (error) {
        warnings.push(`${moto.session}: lap chart not parsed (${error.message}); lap times kept without positions`);
      }
    }
    if (chart) {
      for (const result of results) {
        const sequence = chart.byPlate.get(result.plate);
        if (!sequence) continue;
        for (const lap of result.laps) {
          const position = sequence[lap.lap - 1];
          if (Number.isInteger(position)) lap.position = position;
        }
      }
    }

    builtMotos.push({
      class: moto.class,
      moto: overallUsed ? 1 : moto.moto,
      session: moto.session,
      results,
    });

    if (moto.qualifyingText) {
      const parsed = parseQualifying(moto.qualifyingText);
      const session = moto.qualifyingSession ?? moto.session.replace(/F\d$/, 'QCOVR');
      const key = `${moto.class}/${session}`;
      if (!qualifyingByKey.has(key)) {
        qualifyingByKey.set(key, {
          class: moto.class,
          session,
          rows: parsed.rows.map((row) => ({
            pos: row.pos,
            plate: row.plate,
            riderId: riderId(row.name, overrides),
            name: row.name,
            bike: row.bike,
            bestMs: row.bestMs,
            sessions: row.sessions,
          })),
        });
      }
    }
  }  return finalizeEvent({
    event,
    motos: builtMotos,
    qualifying: [...qualifyingByKey.values()],
    sources,
    warnings,
  });
}

export async function fetchText(url, offline) {
  const { bytes, meta } = await fetchBytes(url, { offline });
  return { text: bytes.toString('utf8'), meta };
}

async function fetchSheetText(url, offline) {
  const { path: pdfPath, meta } = await fetchPdf(url, { offline });
  const text = await pdfToText(pdfPath, { layout: true });
  return { text, meta };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

/**
 * Fetch and assemble one event, without validating or writing it. Shared by the
 * CLI and by scripts/survey.js so a survey exercises the real ingest path.
 */
export async function collectEvent({ eventId, base = AMA_BASE, series = 'MX', offline = false }) {
  const manifest = parseManifest((await fetchText(manifestUrl(eventId, base, series), offline)).text);
  if (!manifest.id) throw new Error('manifest: no event id');

  const overrides = await loadOverrides();
  const sources = [];
  const motos = [];

  for (const session of motoSessions(manifest, series)) {
    // A synthesized session exists only for a Triple Crown manifest that lists no
    // `F` session at all; its overall sheet is then fetched by convention.
    const has = (kind) =>
      !session.synthetic && manifest.sessions.find((s) => s.id === session.id)?.sheets.some((sheet) => sheet.kind === kind);
    // A Triple Crown round replaces the class result sheet with an OVERALL
    // classification (the `PRESS` sheet), which is the round's finishing order.
    const useOverall = Boolean(session.synthetic) || (!has('results') && has('official-results'));
    if (!session.synthetic && !has('results') && !useOverall) {
      throw new Error(`${session.id}: manifest lists no results sheet`);
    }

    let resultsText = null;
    let overallText = null;
    if (session.synthetic) {
      // The archive's incomplete manifests still publish the first main event, so
      // it stands in when the overall classification cannot be read.
      const fallbackUrl = `${base}/xml/${series}/events/${eventId}/${session.classCode}E1RES.pdf`;
      const fallback = await fetchSheetText(fallbackUrl, offline);
      resultsText = fallback.text;
      sources.push({ url: fallbackUrl, sha256: fallback.meta.sha256 });
    }
    if (useOverall) {
      const overallUrl = `${base}/xml/${series}/events/${eventId}/${session.id}PRESS.pdf`;
      const overall = await fetchSheetText(overallUrl, offline);
      overallText = overall.text;
      sources.push({ url: overallUrl, sha256: overall.meta.sha256 });
    } else {
      const resultsUrl = `${base}/xml/${series}/events/${eventId}/${session.id}RES.pdf`;
      const results = await fetchSheetText(resultsUrl, offline);
      resultsText = results.text;
      sources.push({ url: resultsUrl, sha256: results.meta.sha256 });
    }

    let lapTimesText = null;
    if (!useOverall && has('lap-times')) {
      const lapUrl = `${base}/xml/${series}/events/${eventId}/${session.id}RID.pdf`;
      const lapTimes = await fetchSheetText(lapUrl, offline);
      lapTimesText = lapTimes.text;
      sources.push({ url: lapUrl, sha256: lapTimes.meta.sha256 });
    }

    // Supercross prints a LAP CHART sheet beside the individual lap times; it is
    // the only source of per-lap positions in the PDF era.
    let lapChartText = null;
    if (series === 'SX' && !useOverall && has('lap-chart')) {
      const chartUrl = `${base}/xml/${series}/events/${eventId}/${session.id}LAP.pdf`;
      const chart = await fetchSheetText(chartUrl, offline);
      lapChartText = chart.text;
      sources.push({ url: chartUrl, sha256: chart.meta.sha256 });
    }

    motos.push({
      class: session.className,
      moto: session.moto,
      session: session.id,
      resultsText,
      overallText,
      lapTimesText,
      lapChartText,
    });
  }

  // Qualifying: attach each class's combined sheet to that class's first moto.
  for (const session of qualifyingSessions(manifest, series)) {
    const url = `${base}${session.path}`;
    const combined = await fetchSheetText(url, offline);
    sources.push({ url, sha256: combined.meta.sha256 });
    // The 250 SX qualifying sheet says `250SX`; attach it to the coast's moto.
    const baseClass = session.className.split(' ')[0];
    const target = motos.find((moto) => moto.class.split(' ')[0] === baseClass);
    // A round whose 250 coast cannot be established still has a results sheet;
    // the qualifying sheet is skipped rather than discarding the whole round.
    if (!target) continue;
    target.qualifyingText = combined.text;
    target.qualifyingSession = session.session;
  }

  return assembleEvent({
    event: {
      id: manifest.id ?? eventId,
      series: series === 'SX' ? 'AMA Supercross' : 'AMA Pro Motocross',
      name: manifest.name,
      track: manifest.track,
      location: manifest.location,
      date: manifest.date,
      round: roundOf(motos),
      ofRounds: ofRoundsOf(motos),
    },
    motos,
    sources,
    overrides,
  });
}

function parsedFirst(motos) {
  const standard = motos.find((moto) => moto.resultsText);
  if (standard) return parseResults(standard.resultsText);
  const overall = motos.find((moto) => moto.overallText);
  return overall ? parseOverall(overall.overallText) : null;
}

const roundOf = (motos) => parsedFirst(motos)?.round ?? null;
const ofRoundsOf = (motos) => parsedFirst(motos)?.ofRounds ?? null;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const eventId = args.event ?? 'M2405';
  const series = args.series === 'SX' ? 'SX' : 'MX';
  const base = args.base ?? AMA_BASE;
  const offline = Boolean(args.offline);

  const event = await collectEvent({ eventId, base, series, offline });
  const { errors, warnings } = validateEvent(event);
  if (errors.length > 0) {
    throw new Error(`validation failed for ${eventId}:\n  ${errors.join('\n  ')}`);
  }

  const outDir = path.resolve('data/events');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${eventId}.json`);
  await writeFile(outPath, stableStringify(event));
  console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
  console.log(`${event.motos.length} motos, ${event.qualifying.length} qualifying sheets, ${event.sources.length} sources`);
  for (const warning of warnings) console.log(`warning: ${warning}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
