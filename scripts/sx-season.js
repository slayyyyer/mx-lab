// Ingest a Supercross season from the AMA PDF archive.
//
//   node scripts/sx-season.js --year 2020
//   node scripts/sx-season.js --seasons 2020,2021,2022 --rounds 17
//
// Round ids follow the archive's own scheme: `S<yy><round × 5>`, so round 1 of
// 2020 is `S2005` and round 17 is `S2085`. A round that does not exist is
// reported and skipped rather than ending the season.
//
// Nothing is written for an event that fails the validation gate.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { collectEvent } from '../src/build.js';
import { stableStringify } from '../src/lib/json.js';
import { validateEvent } from '../src/validate.js';

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
};

const years = (arg('seasons') ?? arg('year') ?? '2020').split(',').map(Number);
const rounds = Number(arg('rounds') ?? 17);
const outDir = path.resolve('data/events');

await mkdir(outDir, { recursive: true });

for (const year of years) {
  let written = 0;
  let rejected = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const id = `S${String(year).slice(2)}${String(round * 5).padStart(2, '0')}`;
    try {
      const event = await collectEvent({ eventId: id, series: 'SX' });
      const { errors, warnings } = validateEvent(event);
      if (errors.length > 0) {
        rejected += 1;
        console.error(`${id}: rejected: ${errors.join('; ')}`);
        continue;
      }
      await writeFile(path.join(outDir, `${id}.json`), stableStringify(event));
      written += 1;
      console.log(
        `${id} ${event.event.name}: ${event.motos.length} motos, ` +
          `${event.qualifying.length} qualifying, ${warnings.length} warnings`,
      );
    } catch (error) {
      console.error(`${id}: ${error.message}`);
    }
  }
  console.log(`${year}: ${written} events written, ${rejected} rejected`);
}
