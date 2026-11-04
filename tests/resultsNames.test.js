import { readFile } from 'node:fs/promises';

import { eq, test } from './harness.js';
import { parseResults } from '../src/parse/results.js';

const text = await readFile(new URL('./fixtures/M2010-M2F1.txt', import.meta.url), 'utf8');
const parsed = parseResults(text);
const byPlate = (plate) => parsed.rows.find((row) => row.plate === plate);

test('results: a place starting left of its header label stays out of the name', () => {
  // `HOMETOWN` is set at column 34 but its values can begin at 32, so slicing at
  // the label used to leave the place's first letters on the name. The column is
  // measured from the sheet, not assumed: `Metamora, MI` is the longest place and
  // begins at the leftmost edge any row shows.
  eq(byPlate(355).name, 'Joseph Crown');
  eq(byPlate(355).hometown, 'Metamora, MI');
  eq(byPlate(364).name, 'Chad Saultz');
  eq(byPlate(364).hometown, 'Batavia, IL');
});

test('results: a place with only one space before it still splits at the column', () => {
  // A full-width name runs into the place with a single space, which is why the
  // boundary cannot be found by looking for a gap on that row.
  eq(byPlate(504).name, 'Gerhard Matamoros');
  eq(byPlate(504).hometown, 'Honduras');
  eq(byPlate(35).name, 'Hunter Lawrence');
  eq(byPlate(35).hometown, 'Australia');
});

test('results: no committed row carries a truncated rider or place', async () => {
  // The shape this parser got wrong: a place cut mid-word (`Matamoros Hon` +
  // `duras`) or a name with the column gap left in it. Scanning the dataset keeps
  // a layout regression from reaching the published numbers unnoticed.
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = new URL('../data/events/', import.meta.url);
  const bad = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.json'))) {
    const event = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    for (const moto of event.motos) {
      for (const row of moto.results) {
        if (/\s{2,}/.test(row.name) || !/^[A-Z0-9]/.test(row.hometown)) {
          bad.push(`${event.event.id} ${moto.class} #${row.plate}: ${JSON.stringify([row.name, row.hometown])}`);
        }
      }
    }
  }
  eq(bad, []);
});

test('results: an ordinary row is unchanged by the measured boundary', () => {
  eq(byPlate(24).name, 'RJ Hampshire');
  eq(byPlate(24).hometown, 'Hudson, FL');
  eq(parsed.rows.length, 40);
  eq(parsed.rows.every((row) => row.hometown.length > 0), true);
});
