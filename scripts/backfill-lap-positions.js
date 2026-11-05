// Backfill per-lap positions for the 2020–2024 PDF era from the archive's LAP
// CHART sheet. Both series publish one per moto: M1F1LAP … for Motocross and
// S1F1LAP … for Supercross.
//
//   node scripts/backfill-lap-positions.js --years 2024 --limit 1
//   node scripts/backfill-lap-positions.js --series MX
//   node scripts/backfill-lap-positions.js --years 2020,2021,2022,2023,2024
//
// The 2020–2024 dataset was built from the results and lap-time sheets only, so
// every lap carries a time and no position. The LAP sheet was always in the
// manifest; this script reads it for each main event, attaches the position to
// the matching lap of the matching plate, and records the sheet in `sources`.
//
// Nothing is written for an event that fails the validation gate, and a sheet
// that cannot be read leaves the event untouched with a printed warning.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fetchBytes, fetchPdf } from '../src/lib/http.js';
import { pdfToText } from '../src/lib/poppler.js';
import { stableStringify } from '../src/lib/json.js';
import { parseLapChart } from '../src/parse/lapChart.js';
import { validateEvent } from '../src/validate.js';
import { AMA_BASE, manifestUrl, parseManifest } from '../src/sources/ama.js';

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
};

const years = (arg('years') ?? '2020,2021,2022,2023,2024').split(',').map(Number);
const seriesFilter = arg('series');
const limit = Number(arg('limit') ?? Infinity);
const dryRun = process.argv.includes('--dry');

const dir = path.resolve('data/events');
const files = (await readdir(dir))
  .filter((file) => /^[SM](20|21|22|23|24)\d\d\.json$/.test(file))
  .filter((file) => years.includes(2000 + Number(file.slice(1, 3))))
  .filter((file) => !seriesFilter || (seriesFilter === 'SX' ? file.startsWith('S') : file.startsWith('M')))
  .sort()
  .slice(0, limit);

if (files.length === 0) {
  console.error('no Supercross events matched');
  process.exit(1);
}

let written = 0;
let skipped = 0;
let positions = 0;
let eventsWithSheet = 0;

for (const [index, file] of files.entries()) {
  const target = path.join(dir, file);
  const event = JSON.parse(await readFile(target, 'utf8'));
  const eventId = event.event.id;
  const series = file.startsWith('S') ? 'SX' : 'MX';
  let charted = 0;

  try {
    const { bytes } = await fetchBytes(manifestUrl(eventId, AMA_BASE, series));
    const manifest = parseManifest(bytes.toString('utf8'));
    const sheets = new Map();
    for (const session of manifest.sessions) {
      for (const sheet of session.sheets) {
        // `M1F2LAP` / `S1F1LAP`: the session id is the key, and it is also the key
        // the dataset stores on the moto.
        const match = sheet.path.match(/([A-Z]\d[A-Z]\d)LAP\.pdf$/i);
        if (sheet.kind === 'lap-chart' && match) sheets.set(match[1], sheet.path);
      }
    }

    for (const moto of event.motos) {
      const relative = sheets.get(moto.session);
      if (!relative) continue;
      const url = relative.startsWith('http') ? relative : AMA_BASE + relative;
      const { path: pdfPath, meta } = await fetchPdf(url);
      const chart = parseLapChart(await pdfToText(pdfPath));
      charted += 1;

      for (const row of moto.results ?? []) {
        const sequence = chart.byPlate.get(row.plate);
        if (!sequence) continue;
        for (const lap of row.laps ?? []) {
          const position = sequence[lap.lap - 1];
          if (Number.isInteger(position)) {
            lap.position = position;
            positions += 1;
          }
        }
      }

      if (!event.sources.some((source) => source.url === meta.url)) {
        event.sources.push({ url: meta.url, sha256: meta.sha256 });
      }
    }
    event.sources.sort((a, b) => a.url.localeCompare(b.url));
    if (charted > 0) eventsWithSheet += 1;

    const { errors } = validateEvent(event);
    if (errors.length > 0) {
      skipped += 1;
      console.error(`${eventId}: rejected after backfill: ${errors.slice(0, 3).join('; ')}`);
      continue;
    }

    if (!dryRun) await writeFile(target, stableStringify(event));
    written += 1;
    console.log(`${eventId} ${event.event.name}: ${charted} charts, ${event.motos.length} motos (${index + 1}/${files.length})`);
  } catch (error) {
    skipped += 1;
    console.error(`${eventId}: ${error.message}`);
  }
}

console.log(
  `${dryRun ? 'dry run' : 'wrote'} ${written} events, ${skipped} skipped, ${eventsWithSheet} with a chart, ${positions} lap positions attached`,
);
