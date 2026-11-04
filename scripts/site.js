// Publish the derived files for the static site.
//
// The site is plain HTML and ES modules, so it fetches its data at runtime. This
// copies data/derived/*.json into site/data/ (git-ignored) and verifies the copy,
// which keeps one authoritative set of numbers in the repository.
//
//   node scripts/site.js           copy
//   node scripts/site.js --check   fail if site/data is missing or differs

import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { DERIVED_FILES } from '../src/derive/index.js';

const from = path.resolve('data/derived');
const to = path.resolve('site/data');
const check = process.argv.includes('--check');

await mkdir(to, { recursive: true });

let problems = 0;
let bytes = 0;
for (const [, file] of DERIVED_FILES) {
  const source = path.join(from, file);
  const target = path.join(to, file);
  const expected = await readFile(source, 'utf8').catch(() => null);
  if (expected === null) {
    console.error(`missing derived file: data/derived/${file} (run: npm run derive)`);
    problems += 1;
    continue;
  }
  bytes += expected.length;
  if (check) {
    const actual = await readFile(target, 'utf8').catch(() => null);
    if (actual !== expected) {
      console.error(`site/data/${file} is ${actual === null ? 'missing' : 'out of date'}`);
      problems += 1;
    }
    continue;
  }
  await copyFile(source, target);
}

if (problems > 0) process.exit(1);
console.log(
  check
    ? `site/data matches data/derived (${DERIVED_FILES.length} files)`
    : `copied ${DERIVED_FILES.length} files (${(bytes / 1024).toFixed(1)} KB) into site/data`,
);
