// Ingest whole 2025/2026 Supercross seasons from `results.supercrosslive.com`.
//
//   node scripts/sx-lt-season.js --years 2025 [--rounds 1,2] [--offline]
//
// Rosters are not written here: `npm run roster` rebuilds every season from the
// committed events, which is what keeps Motocross and Supercross plates in one
// `class:plate` map for 2025 and 2026.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { collectSxLtEvent } from '../src/build-sx-lt.js';
import { fetchText } from '../src/build.js';
import { stableStringify } from '../src/lib/json.js';
import { SX_EVENT_INDEX_URL, parseEventIndex } from '../src/sources/supercross.js';
import { validateEvent } from '../src/validate.js';

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const years = argValue('years', '2025').split(',').map(Number);
const only = argValue('rounds', '')
  .split(',')
  .filter(Boolean)
  .map(Number);
const offline = process.argv.includes('--offline');

const index = parseEventIndex((await fetchText(SX_EVENT_INDEX_URL, offline)).text);

let written = 0;
let failed = 0;
for (const year of years) {
  const season = index
    .filter((entry) => entry.year === year)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (season.length === 0) throw new Error(`no Supercross events found for ${year}`);

  for (const [position, entry] of season.entries()) {
    const round = position + 1;
    if (only.length > 0 && !only.includes(round)) continue;
    try {
      const event = await collectSxLtEvent({
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
          `${event.motos.map((moto) => moto.class).join(' + ')}  ${warnings.length} warnings`,
      );
    } catch (error) {
      failed += 1;
      console.log(`FAILED ${year} round ${round} (${entry.siteId}) ${entry.name}: ${error.message}`);
    }
  }
}

console.log(`\n${written} event(s) written, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
