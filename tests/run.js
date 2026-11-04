// Runs every *.test.js in this directory against the in-repo harness.

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runAll } from './harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = (await readdir(here)).filter((file) => file.endsWith('.test.js')).sort();

for (const file of files) {
  await import(pathToFileURL(path.join(here, file)).href);
}

const ok = await runAll();
process.exit(ok ? 0 : 1);
