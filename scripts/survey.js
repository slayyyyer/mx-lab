// Survey a season: run the real ingest for every event and report which ones the
// parsers accept, refuse, or which do not exist.
//
// This exists because the parsers are deliberately strict: an unknown layout is
// refused rather than half-parsed. The refusal list is therefore the work
// estimate for supporting a season, and it must be cheap to produce.
//
//   node scripts/survey.js --years 2020,2021,2022,2023 [--concurrency 4]

import { collectEvent } from '../src/build.js';
import { validateEvent } from '../src/validate.js';

// Last round number per season, from the archive's own event-id scheme
// (M<YY><NN>, stride 5 from 05). Rounds are not always contiguous.
const LAST_ROUND = { 2019: 55, 2020: 45, 2021: 60, 2022: 60, 2023: 55, 2024: 55, 2025: 55 };

function eventIds(year) {
  const suffix = String(year).slice(2);
  const last = LAST_ROUND[year];
  if (!last) throw new Error(`unknown season ${year}`);
  const ids = [];
  for (let round = 5; round <= last; round += 5) ids.push(`M${suffix}${String(round).padStart(2, '0')}`);
  return ids;
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const years = argValue('years', '2020,2021,2022,2023').split(',').map(Number);
const concurrency = Number(argValue('concurrency', '4'));

const ids = years.flatMap(eventIds);
const rows = await pool(ids, concurrency, async (id) => {
  try {
    const event = await collectEvent({ eventId: id });
    const { errors, warnings } = validateEvent(event);
    const lapTimes = event.motos.reduce(
      (total, moto) => total + moto.results.reduce((n, row) => n + row.laps.length, 0),
      0,
    );
    return {
      id,
      status: errors.length === 0 ? 'ok' : 'invalid',
      detail: errors.length === 0 ? `${event.motos.length} motos, ${lapTimes} lap times` : errors[0],
      name: event.event.name ?? '',
      date: event.event.date ?? '',
      warnings: warnings.length,
    };
  } catch (error) {
    const message = String(error.message ?? error).split('\n')[0];
    return { id, status: /HTTP 404/.test(message) ? 'absent' : 'refused', detail: message, name: '', date: '' };
  }
});

for (const row of rows) {
  const label = `${row.id} ${row.date} ${row.name}`.trimEnd();
  console.log(`${row.status.padEnd(8)} ${label}${row.detail ? `\n         ${row.detail}` : ''}`);
}

const counts = rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
console.log(
  `\n${rows.length} events surveyed: ` +
    Object.entries(counts)
      .map(([status, count]) => `${count} ${status}`)
      .join(', '),
);
process.exit((counts.refused ?? 0) > 0 ? 1 : 0);
