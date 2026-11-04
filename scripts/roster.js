// Build a season roster from the committed dataset — every season, one shape.
//
//   node scripts/roster.js                    # every season present in data/events
//   node scripts/roster.js --years 2020,2021
//
// It reads only committed events, so it needs no network and a change in a
// roster shows up as a reviewable diff.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createRoster, rosterFile } from '../src/roster.js';

const sourceFor = (year) => (year >= 2025 ? 'results.promotocross.com' : 'americanmotocrossresults.com');

const index = process.argv.indexOf('--years');
const requested = index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;

const eventsDir = path.resolve('data/events');
const events = [];
for (const file of (await readdir(eventsDir)).filter((name) => name.endsWith('.json')).sort()) {
  const event = JSON.parse(await readFile(path.join(eventsDir, file), 'utf8'));
  events.push({ id: event.event.id, year: Number(event.event.date.slice(0, 4)), event });
}

const years = requested
  ? requested.split(',').map(Number)
  : [...new Set(events.map((entry) => entry.year))].sort();

for (const year of years) {
  const season = events.filter((entry) => entry.year === year).sort((a, b) => a.id.localeCompare(b.id));
  if (season.length === 0) throw new Error(`no committed events for ${year}`);

  const roster = createRoster();
  for (const { event } of season) {
    for (const moto of event.motos) {
      for (const row of moto.results) {
        roster.add({
          className: moto.class,
          plate: row.plate,
          riderId: row.riderId,
          name: row.name,
          eventId: event.event.id,
        });
      }
    }
  }
  const { riders, warnings } = roster.build();

  await mkdir(path.resolve('data/rosters'), { recursive: true });
  await writeFile(
    path.resolve('data/rosters', `${year}.json`),
    rosterFile({ season: year, source: sourceFor(year), eventCount: season.length, riders, warnings }),
  );

  const folded = riders.filter((rider) => rider.aliases.length > 0).length;
  console.log(
    `${year}: ${season.length} events, ${riders.length} plates, ${folded} with folded spellings, ${warnings.length} warnings`,
  );
}
