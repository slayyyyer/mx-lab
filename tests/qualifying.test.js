import { readFile } from 'node:fs/promises';

import { assert, eq, test } from './harness.js';
import { parseQualifying } from '../src/parse/qualifying.js';

const text = await readFile(new URL('./fixtures/M2405/M1QCOVR.layout.txt', import.meta.url), 'utf8');
const parsed = parseQualifying(text);

test('qualifying: there are more entrants than moto starters', () => {
  // 71 entrants at Pala against 40 starters: the sheet is the whole entry list,
  // not the moto field, and it is split at `TOP 36 RIDERS QUALIFY`.
  eq(parsed.class, '450MX');
  eq(parsed.rows.length, 71);
});

test('qualifying: every position from 1 to the last entrant is present once', () => {
  eq(parsed.rows.map((row) => row.pos), Array.from({ length: 71 }, (_, i) => i + 1));
});

test('qualifying: pole time', () => {
  const pole = parsed.rows[0];
  eq(pole.pos, 1);
  eq(pole.plate, 1);
  eq(pole.name, 'Jett Lawrence');
  eq(pole.bestMs, 138467);
});

test('qualifying: published best equals the fastest session', () => {
  for (const row of parsed.rows) {
    const sessions = row.sessions.filter((time) => typeof time === 'number');
    if (sessions.length === 0) continue;
    eq(row.bestMs, Math.min(...sessions), `#${row.plate} best time`);
  }
});

test('qualifying: ranking is ordered by best time', () => {
  for (let i = 1; i < parsed.rows.length; i += 1) {
    assert(parsed.rows[i].bestMs >= parsed.rows[i - 1].bestMs, `#${parsed.rows[i].plate} out of order`);
  }
});

test('qualifying: unrun sessions are null, not zero', () => {
  const pole = parsed.rows[0];
  assert(pole.sessions.includes(null), 'expected at least one empty session for the pole sitter');
});
