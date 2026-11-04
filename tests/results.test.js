import { readFile } from 'node:fs/promises';

import { eq, test } from './harness.js';
import { parseResults } from '../src/parse/results.js';

const text = await readFile(new URL('./fixtures/M2405/M1F1RES.layout.txt', import.meta.url), 'utf8');
const parsed = parseResults(text);

test('results: class and moto come from the title line, not the sheet code', () => {
  eq(parsed.class, '450MX');
  eq(parsed.moto, 1);
});

test('results: reads all 40 entries', () => {
  eq(parsed.rows.length, 40);
});

test('results: round header', () => {
  eq(parsed.round, 1);
  eq(parsed.ofRounds, 11);
});

test('results: winner', () => {
  const winner = parsed.rows[0];
  eq(winner.pos, 1);
  eq(winner.plate, 1);
  eq(winner.name, 'Jett Lawrence');
  eq(winner.lapsCompleted, 15);
  eq(winner.bestLapMs, 143895);
  eq(winner.gapMs, null);
  eq(winner.team, 'Team Honda HRC');
});

test('results: a rider a lap down records completed laps, not a gap', () => {
  const lapped = parsed.rows.find((row) => row.plate === 416);
  eq(lapped.pos, 21);
  eq(lapped.lapsCompleted, 14);
  eq(lapped.gapMs, null);
  eq(lapped.status, null);
});

test('results: a gap over a minute is minutes and seconds', () => {
  const row = parsed.rows.find((entry) => entry.plate === 58);
  eq(row.gapMs, 104995);
  eq(row.gapRaw, '+1:44.995');
});

test('results: DNF keeps its status and has no best lap', () => {
  const dnf = parsed.rows.find((row) => row.status === 'DNF');
  eq(dnf.plate, 84);
  eq(dnf.bestLapMs, null);
  eq(dnf.lapsCompleted, null);
});

test('results: positions are unique and complete', () => {
  const positions = parsed.rows.map((row) => row.pos);
  eq(new Set(positions).size, positions.length);
  eq(Math.min(...positions), 1);
  eq(Math.max(...positions), 40);
});

test('results: UTF-8 names survive extraction', () => {
  const noren = parsed.rows.find((row) => row.plate === 22);
  eq(noren.name, 'Freddie Noren');
  eq(noren.hometown, 'Lidköping, Sweden');
});

const text250 = await readFile(new URL('./fixtures/M2405/M2F1RES.layout.txt', import.meta.url), 'utf8');
const parsed250 = parseResults(text250);

test('results: the 250 sheet is a different class on the same layout', () => {
  eq(parsed250.class, '250MX');
  eq(parsed250.moto, 1);
  eq(parsed250.rows.length, 40);
});

test('results: a row whose fields wrapped onto a second line is reassembled', () => {
  // #108 at Pala: the name is on the row line, and hometown / bike / DNF are on
  // the following line. Without continuation handling this row is unparsable.
  const wrapped = parsed250.rows.at(-1);
  eq(wrapped.pos, 40);
  eq(wrapped.plate, 108);
  eq(wrapped.name, 'Jorgen-Matthias Talviku');
  eq(wrapped.hometown, 'Parnu, Estonia');
  eq(wrapped.bike, 'KTM 250 SX-F');
  eq(wrapped.status, 'DNF');
});

test('results: the wrapped row did not swallow the field', () => {
  eq(parsed250.rows.map((row) => row.pos).length, 40);
  eq(parsed250.rows.at(-1).gapMs, null);
});
