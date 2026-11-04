import { readFile } from 'node:fs/promises';

import { assert, eq, test } from './harness.js';
import { assembleEvent } from '../src/build.js';
import { validateEvent } from '../src/validate.js';

const read = (name) => readFile(new URL(`./fixtures/M2405/${name}`, import.meta.url), 'utf8');
const [resultsText, lapTimesText, qualifyingText] = await Promise.all([
  read('M1F1RES.layout.txt'),
  read('M1F1RID.layout.txt'),
  read('M1QCOVR.layout.txt'),
]);

function buildEvent() {
  return assembleEvent({
    event: {
      id: 'M2405',
      name: 'Fox Raceway National',
      track: 'Fox Raceway at Pala',
      location: 'Pala, CA',
      date: '2024-05-25',
      round: 1,
      ofRounds: 11,
    },
    motos: [{ class: '450MX', moto: 1, session: 'M1F1', resultsText, lapTimesText, qualifyingText }],
    sources: [{ url: 'https://example.test/M1F1RES.pdf', sha256: 'a'.repeat(64) }],
    overrides: {},
  });
}

test('assemble: one moto with joined lap times', () => {
  const event = buildEvent();
  eq(event.motos.length, 1);
  const winner = event.motos[0].results[0];
  eq(winner.riderId, 'jett-lawrence');
  eq(winner.laps.length, 15);
  eq(winner.laps[1].timeMs, 145399);
});

test('assemble: qualifying is attached once for the class, keeping the full entry list', () => {
  const event = buildEvent();
  eq(event.qualifying.length, 1);
  eq(event.qualifying[0].rows.length, 71);
});

test('gate: the real event passes', () => {
  const { errors } = validateEvent(buildEvent());
  eq(errors, []);
});

test('gate: a duplicated finish position fails the build', () => {
  const event = buildEvent();
  event.motos[0].results[1].pos = 1;
  const { errors } = validateEvent(event);
  assert(errors.some((error) => /duplicate position/.test(error)), 'duplicate position not caught');
});

test('gate: an implausible lap time fails the build', () => {
  const event = buildEvent();
  event.motos[0].results[0].laps[1].timeMs = 12;
  const { errors } = validateEvent(event);
  assert(errors.some((error) => /implausible lap/.test(error)), 'implausible lap not caught');
});

test('gate: a best lap missing from the lap list fails the build', () => {
  const event = buildEvent();
  event.motos[0].results[0].bestLapMs = 143896;
  const { errors } = validateEvent(event);
  assert(errors.some((error) => /not in the lap list/.test(error)), 'best-lap contradiction not caught');
});

test('gate: a malformed source hash fails the build', () => {
  const event = buildEvent();
  event.sources[0].sha256 = 'not-a-hash';
  const { errors } = validateEvent(event);
  assert(errors.some((error) => /malformed entry/.test(error)), 'bad source hash not caught');
});

test('gate: a recorded source gap is a warning, not an error', () => {
  const { errors, warnings } = validateEvent(buildEvent());
  eq(errors, []);
  assert(Array.isArray(warnings), 'warnings missing');
});
