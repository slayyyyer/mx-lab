import { readFile } from 'node:fs/promises';

import { assert, eq, test } from './harness.js';
import { datasetId, displayName, sessionIdFor } from '../src/build-lt.js';
import { parseGapCell, parseLtTime, parseMotoReport, parsePosition, parseQualifyingReport } from '../src/parse/lt.js';
import { classifyReport, isChampionshipEvent, parseEventHub, parseEventIndex } from '../src/sources/promotocross.js';
import { validateEvent } from '../src/validate.js';

const fixture = (name) => readFile(new URL(`./fixtures/LT/${name}`, import.meta.url), 'utf8');

const moto = parseMotoReport(await fixture('moto.html'), { className: '250MX', moto: 1 });
const qualifying = parseQualifyingReport(await fixture('qualifying.html'), { className: '250MX' });
const hub = parseEventHub(await fixture('hub.html'));
const index = parseEventIndex(await fixture('index.html'));

test('lt: a time without milliseconds is still a time', () => {
  // 2025–2026 prints `2:04` when the fraction is zero; refusing it would drop the
  // fastest qualifier's best lap.
  eq(parseLtTime('2:05.182'), 125182);
  eq(parseLtTime('2:04'), 124000);
  eq(parseLtTime('---'), null);
  eq(parseLtTime(''), null);
});

test('lt: gaps are seconds, not only minutes', () => {
  eq(parseGapCell('7.917'), 7917);
  eq(parseGapCell('+1:44.995'), 104995);
  // A lapped rider's `1 Lap` is not a gap, and must never become 1000ms.
  eq(parseGapCell('1 Lap'), null);
  eq(parseGapCell('DNF'), null);
});

test('lt: per-lap positions are integers, two-digit places included', () => {
  eq(parsePosition('3rd'), 3);
  eq(parsePosition('1st'), 1);
  eq(parsePosition('21st'), 21);
  eq(parsePosition('--'), null);
});

test('lt: a rider name drops the Holeshot annotation', () => {
  // The results table appends ` Holeshot` to the rider who took it, which would
  // otherwise split one rider into two ids across a season.
  eq(displayName('HAIDEN DEEGAN Holeshot'), 'Haiden Deegan');
  eq(displayName('RJ HAMPSHIRE'), 'RJ Hampshire');
  eq(displayName('jett lawrence'), 'Jett Lawrence');
});

test('lt: dataset ids and session ids follow the PDF era', () => {
  eq(datasetId(2025, 4), 'LT2504');
  eq(datasetId(2026, 11), 'LT2611');
  eq(sessionIdFor('250MX', 1), 'M2F1');
  eq(sessionIdFor('450MX', 2), 'M1F2');
});

test('lt: a moto report yields riders with their own lap tables', () => {
  eq(moto.riders.length, 3);
  eq(moto.riders.map((rider) => rider.pos), [1, 20, 40]);
  eq(moto.riders.map((rider) => rider.plate), [1, 75, 134]);
  eq(moto.riders[0].name, 'HAIDEN DEEGAN');
  eq(moto.riders[0].bike, 'Yamaha');
  eq(moto.riders.at(-1).bike, 'KTM');
  eq(moto.riders.every((rider) => rider.name.length > 3), true);
});

test('lt: laps carry a position, and lap 1 has a time', () => {
  const winner = moto.riders[0];
  eq(winner.laps.length, 17);
  eq(winner.laps[0], { lap: 1, timeMs: 119024, position: 3 });
  eq(winner.bestLapMs, 125182);
  eq(winner.lapsCompleted, 17);
});

test('lt: laps completed comes from TOTAL TIME, not INTERVAL', () => {
  // The last rider's INTERVAL reads `13 Laps` — that is how many laps down he
  // finished, not how many he rode. TOTAL TIME prints `4/8:50.212`.
  const last = moto.riders.at(-1);
  eq(last.interval, '13 Laps');
  eq(last.lapsCompleted, 4);
  eq(last.laps.length, 4);
});

test('lt: qualifying keeps every entrant and their best lap', () => {
  eq(qualifying.rows.length, 3);
  eq(qualifying.rows[0].plate, 56);
  eq(qualifying.rows[0].bestMs, 123447);
  eq(qualifying.rows[0].bike, 'Kawasaki');
});

test('lt: the event hub says which reports exist', () => {
  const motos = hub.reports.filter((report) => report.kind === 'moto');
  const ranked = hub.reports.filter((report) => report.kind === 'qualifying');
  eq(motos.length, 4);
  eq(ranked.length, 2);
  // The hub groups by moto, not by class: both Moto 1s come first.
  eq(motos.map((report) => `${report.className} M${report.moto}`), ['250MX M1', '450MX M1', '250MX M2', '450MX M2']);
  assert(ranked.every((report) => report.classId), 'qualifying report lost its class id');
});

test('lt: every moto label style in 2025–2026 is recognised', () => {
  eq(classifyReport('250 Moto 1').kind, 'moto');
  eq(classifyReport('250 Class Moto 1').kind, 'moto');
  eq(classifyReport('250 Class Moto #1').moto, 1);
  eq(classifyReport('450 Class Moto #2').className, '450MX');
  eq(classifyReport('--> 450 Class Moto #2').moto, 2);
  eq(classifyReport('250 Group B Qualifier 1').kind, 'other');
  eq(classifyReport('250 Combined Qualifying Results').kind, 'qualifying');
});

test('lt: the archive index gives every event a date and a year', () => {
  eq(index.length, 4);
  eq(index[0].year, 2026);
  eq(index[0].date, '2026-08-29');
  eq(isChampionshipEvent('WMX - Budds Creek'), false);
  eq(isChampionshipEvent('Moto Combine - Ironman'), false);
  eq(isChampionshipEvent('Ironman - Crawfordsville, IN'), true);
});

test('lt: a committed 2025 event validates, with per-lap positions throughout', async () => {
  const event = JSON.parse(await readFile(new URL('../data/events/LT2509.json', import.meta.url), 'utf8'));
  const { errors } = validateEvent(event);
  eq(errors, []);
  eq(event.schema, 2);
  const laps = event.motos.flatMap((entry) => entry.results.flatMap((row) => row.laps));
  assert(laps.length > 2000, `expected a full event of lap times, got ${laps.length}`);

  // A rider who dropped out can have laps with no position printed; what matters
  // is that a position is never invented and never non-numeric.
  const withPosition = laps.filter((lap) => lap.position !== null && lap.position !== undefined);
  assert(withPosition.length / laps.length > 0.95, `only ${withPosition.length}/${laps.length} laps carry a position`);
  eq(withPosition.every((lap) => Number.isInteger(lap.position) && lap.position > 0), true);
});
