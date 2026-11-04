// Build every derived analysis file from the committed dataset.
//
//   node scripts/derive.js           write data/derived/*.json
//   node scripts/derive.js --check   fail if the committed files are stale
//
// The output is deterministic (sorted keys, rounded floats, no timestamps), so a
// rebuild of an unchanged dataset is byte-identical and `--check` is meaningful.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DERIVED_FILES, deriveAll } from '../src/derive/index.js';
import { stableStringify } from '../src/lib/json.js';

const eventsDir = path.resolve('data/events');
const outDir = path.resolve('data/derived');
const check = process.argv.includes('--check');

const files = (await readdir(eventsDir)).filter((file) => file.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('no committed events in data/events');
  process.exit(1);
}

const events = [];
for (const file of files) {
  events.push(JSON.parse(await readFile(path.join(eventsDir, file), 'utf8')));
}

const derived = deriveAll(events);
await mkdir(outDir, { recursive: true });

let stale = 0;
for (const [key, file] of DERIVED_FILES) {
  const text = stableStringify(derived[key]);
  const target = path.join(outDir, file);
  const existing = await readFile(target, 'utf8').catch(() => null);
  if (check) {
    if (existing !== text) {
      stale += 1;
      console.error(`stale: data/derived/${file}`);
    }
    continue;
  }
  await writeFile(target, text);
  console.log(`wrote data/derived/${file} (${(text.length / 1024).toFixed(1)} KB)`);
}

if (check) {
  if (stale > 0) {
    console.error(`${stale} derived file(s) do not match the dataset; run: npm run derive`);
    process.exit(1);
  }
  console.log(`derived files match the dataset (${DERIVED_FILES.length} files)`);
} else {
  const { dataset } = derived.meta;
  console.log(
    `${dataset.events} events, ${dataset.rows} rows, ${dataset.laps} laps -> ` +
      `${derived.fade.coverage.riderMotos} motos measured for fade, ` +
      `${derived.lapChart.coverage.lapsWithPosition} laps with a position`,
  );
}
