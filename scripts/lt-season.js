// Ingest whole 2025/2026 seasons from `results.promotocross.com`, and derive the
// season roster.
//
// The roster exists because a plate is unique per rider within a season (Justin,
// 2026-11-04): it is what lets a rider be identified across events when a sheet
// lists a number without a usable name, and it is the cheapest way to notice a
// plate that silently changes meaning mid-season.
//
//   node scripts/lt-season.js --years 2025 [--offline]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { collectLtEvent } from '../src/build-lt.js';
import { fetchText } from '../src/build.js';
import { stableStringify } from '../src/lib/json.js';
import { createRoster, rosterFile } from '../src/roster.js';
import { EVENT_INDEX_URL, isChampionshipEvent, parseEventIndex } from '../src/sources/promotocross.js';
import { validateEvent } from '../src/validate.js';

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const years = argValue('years', '2025').split(',').map(Number);
const offline = process.argv.includes('--offline');

const index = parseEventIndex((await fetchText(EVENT_INDEX_URL, offline)).text);
const events = index.filter((entry) => entry.year && isChampionshipEvent(entry.name));

let written = 0;
let failed = 0;
for (const year of years) {
  const season = events
    .filter((entry) => entry.year === year)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (season.length === 0) throw new Error(`no championship events found for ${year}`);

  const roster = createRoster();

  for (const [position, entry] of season.entries()) {
    const round = position + 1;
    try {
      const event = await collectLtEvent({
        siteEventId: entry.siteId,
        year,
        round,
        ofRounds: season.length,
        name: entry.name,
        date: entry.date,
        offline,
      });
      const { errors, warnings } = validateEvent(event);
      if (errors.length > 0) throw new Error(errors[0]);
      await mkdir(path.resolve('data/events'), { recursive: true });
      await writeFile(path.resolve('data/events', `${event.event.id}.json`), stableStringify(event));
      written += 1;
      console.log(
        `wrote ${event.event.id}  ${event.event.date}  ${event.event.name}  ` +
          `${event.motos.length} motos, ${event.qualifying.length} qualifying, ${warnings.length} warnings`,
      );

      for (const moto of event.motos) {
        for (const row of moto.results) {
          // The roster is keyed by class *and* plate: `#1` is one rider in 450
          // and a different one in 250 (see src/roster.js).
          roster.add({
            className: moto.class,
            plate: row.plate,
            riderId: row.riderId,
            name: row.name,
            eventId: event.event.id,
          });
        }
      }
    } catch (error) {
      failed += 1;
      console.log(`FAILED ${year} round ${round} (${entry.siteId}) ${entry.name}: ${error.message}`);
    }
  }

  const { riders, warnings } = roster.build();

  await mkdir(path.resolve('data/rosters'), { recursive: true });
  await writeFile(
    path.resolve('data/rosters', `${year}.json`),
    rosterFile({ season: year, source: 'results.promotocross.com', eventCount: season.length, riders, warnings }),
  );
  console.log(`${year}: ${riders.length} plates in the roster, ${warnings.length} warnings`);
}

console.log(`\n${written} event(s) written, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
