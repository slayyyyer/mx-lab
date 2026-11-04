import { readFile } from 'node:fs/promises';

import { assert, eq, test } from './harness.js';
import { parseLapTimes } from '../src/parse/lapTimes.js';

const text = await readFile(new URL('./fixtures/M2405/M1F1RID.layout.txt', import.meta.url), 'utf8');
const parsed = parseLapTimes(text);

const byPlate = new Map(parsed.riders.map((rider) => [rider.plate, rider]));

test('lap times: 39 of the 40 riders have lap times; the DNF has none', () => {
  // #84 (Anthony Rodriguez) crashed out on lap 1 and the sheet prints no lap
  // times for him at all, so he must not appear as a rider with an empty list.
  const plates = parsed.riders.map((rider) => rider.plate);
  eq(parsed.riders.length, 39);
  eq(plates.includes(84), false);
});

test('lap times: lap 1 has no time and is null, never zero', () => {
  const jett = byPlate.get(1);
  eq(jett.laps.length, 15);
  eq(jett.laps[0], { lap: 1, timeMs: null });
  eq(jett.laps[1].lap, 2);
});

test('lap times: fastest lap agrees with the results sheet best time', () => {
  const jett = byPlate.get(1);
  const fastest = Math.min(...jett.laps.filter((lap) => lap.timeMs !== null).map((lap) => lap.timeMs));
  eq(fastest, 143895);
  eq(jett.minMs, 143895);
});

test('lap times: lap numbers are unique and ascending per rider', () => {
  for (const rider of parsed.riders) {
    const numbers = rider.laps.map((lap) => lap.lap);
    eq(new Set(numbers).size, numbers.length, `#${rider.plate} has duplicate lap numbers`);
    for (let i = 1; i < numbers.length; i += 1) {
      assert(numbers[i] > numbers[i - 1], `#${rider.plate} laps are not ascending`);
    }
  }
});

test('lap times: every recorded time is plausible for a motocross lap', () => {
  for (const rider of parsed.riders) {
    for (const lap of rider.laps) {
      if (lap.timeMs === null) continue;
      assert(lap.timeMs > 60000 && lap.timeMs < 400000, `#${rider.plate} lap ${lap.lap}: ${lap.timeMs}ms`);
    }
  }
});

test('lap times: a rider whose fast lap printed as the MIN marker loses that lap line, and it is reported', () => {
  // The summary block shifts upward for a rider with fewer recorded laps, so the
  // MIN cell lands on a lap line. The parser must not read MIN as a lap number.
  for (const rider of parsed.riders) {
    assert(
      rider.laps.every((lap) => Number.isInteger(lap.lap) && lap.lap >= 1),
      `#${rider.plate} has a non-numeric lap number`,
    );
  }
  assert(parsed.warnings.length === 0, `unexpected unparsed cells: ${parsed.warnings.join('; ')}`);
});
