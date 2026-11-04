import { readdir, readFile } from 'node:fs/promises';

import { assert, eq, test } from './harness.js';
import { createRoster } from '../src/roster.js';

test('roster: a name that spilled into the next column folds into its rider', () => {
  const roster = createRoster();
  for (let i = 0; i < 9; i += 1) {
    roster.add({ className: '250MX', plate: 124, riderId: 'lane-shaw', name: 'Lane Shaw', eventId: `E${i}` });
  }
  roster.add({ className: '250MX', plate: 124, riderId: 'lane-shaw-alv', name: 'Lane Shaw         Alv', eventId: 'E9' });

  const { riders, warnings } = roster.build();
  eq(riders.length, 1);
  eq(riders[0].riderId, 'lane-shaw');
  eq(riders[0].name, 'Lane Shaw');
  eq(riders[0].aliases, ['lane-shaw-alv']);
  eq(riders[0].events, 10);
  eq(warnings, []);
});

test('roster: a different rider on the same plate is a warning, not an alias', () => {
  const roster = createRoster();
  roster.add({ className: '450MX', plate: 17, riderId: 'jason-anderson', name: 'Jason Anderson', eventId: 'E1' });
  roster.add({ className: '450MX', plate: 17, riderId: 'jason-anderson', name: 'Jason Anderson', eventId: 'E2' });
  roster.add({ className: '450MX', plate: 17, riderId: 'carson-brown', name: 'Carson Brown', eventId: 'E9' });

  const { riders, warnings } = roster.build();
  eq(riders[0].riderId, 'jason-anderson');
  eq(riders[0].aliases, []);
  eq(warnings.length, 1);
  assert(warnings[0].includes('carson-brown'), `unexpected warning: ${warnings[0]}`);
});

test('roster: the same number in both classes is two riders', () => {
  const roster = createRoster();
  roster.add({ className: '450MX', plate: 1, riderId: 'jett-lawrence', name: 'Jett Lawrence', eventId: 'E1' });
  roster.add({ className: '250MX', plate: 1, riderId: 'haiden-deegan', name: 'Haiden Deegan', eventId: 'E1' });

  const { riders, warnings } = roster.build();
  // 250MX sorts before 450MX, and neither is a spelling of the other.
  eq(riders.map((rider) => rider.riderId), ['haiden-deegan', 'jett-lawrence']);
  eq(warnings, []);
});

test('roster: a plate is required', () => {
  const roster = createRoster();
  let threw = false;
  try {
    roster.add({ className: '250MX', plate: null, riderId: 'nobody', name: 'Nobody' });
  } catch (error) {
    threw = /without a plate/.test(error.message);
  }
  eq(threw, true);
});

test('roster: every committed row resolves through its own season roster', async () => {
  // Coverage is the point of the roster: no rider row may be missing from it.
  const eventsDir = new URL('../data/events/', import.meta.url);
  const files = (await readdir(eventsDir)).filter((name) => name.endsWith('.json'));
  const rosters = new Map();

  for (const file of files) {
    const event = JSON.parse(await readFile(new URL(file, eventsDir), 'utf8'));
    const year = Number(event.event.date.slice(0, 4));
    if (!rosters.has(year)) {
      const roster = createRoster();
      for (const other of files) {
        const candidate = JSON.parse(await readFile(new URL(other, eventsDir), 'utf8'));
        if (Number(candidate.event.date.slice(0, 4)) !== year) continue;
        for (const moto of candidate.motos) {
          for (const row of moto.results) {
            roster.add({
              className: moto.class,
              plate: row.plate,
              riderId: row.riderId,
              name: row.name,
              eventId: candidate.event.id,
            });
          }
        }
      }
      const built = roster.build();
      rosters.set(year, new Map(built.riders.map((entry) => [`${entry.class}:${entry.plate}`, entry])));
    }

    for (const moto of event.motos) {
      for (const row of moto.results) {
        const entry = rosters.get(year).get(`${moto.class}:${row.plate}`);
        assert(entry, `${event.event.id} ${moto.class} #${row.plate} (${row.riderId}) is not in the ${year} roster`);
        const known = [entry.riderId, ...entry.aliases, ...entry.otherRiders];
        assert(known.includes(row.riderId), `${row.riderId} is neither the roster id nor an alias for ${moto.class} #${row.plate}`);
      }
    }
  }
  eq(rosters.size, 7);
});

test('roster: the committed 2025 and 2026 files hold one rider per class:plate', async () => {
  for (const year of [2025, 2026]) {
    const file = JSON.parse(await readFile(new URL(`../data/rosters/${year}.json`, import.meta.url), 'utf8'));
    eq(file.season, year);
    const keys = file.riders.map((entry) => `${entry.class}:${entry.plate}`);
    eq(new Set(keys).size, keys.length);
    eq(file.warnings, []);
  }
});
