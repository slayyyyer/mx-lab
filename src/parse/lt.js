// LiveTime race report (`?p=view_race_result&id=…`) and combined qualifying
// report (`?p=view_combined_round_ranking&…`), parsed as HTML.
//
// Race report shape, from `Moto 1` at Ironman 2025:
//
//   POS | # | BIKE | RIDER | INTERVAL | BEST LAP (LAP #) | TOTAL TIME | HOMETOWN | TEAM
//    1  | 1 |      | HAIDEN DEEGAN | 17 Laps | 2:05.182 (5) | 17/35:52.870 | …
//
// and each rider row is followed by a collapsed `<tr id="driver_details_…">`
// holding a `Lap Times` table with one row per lap:
//
//   # | LAP TIME TIME OF DAY | SECTORS | PACE | POS
//   1 | 1:59.024 | S1: --- … | 18/35:42.440 | 3rd
//
// Hazards this parser is built around:
//   - The BIKE column holds a manufacturer logo, not text: the brand is read
//     from the image path (`…/manufacturers/primary/yamaha.png`).
//   - `BEST LAP` sometimes drops the fraction (`2:04`), so a time without
//     milliseconds is still a time.
//   - The lap table is inside the rider's own block, so laps are attached by
//     block (`driver_id_<n>`), never by row order.
//   - The per-lap `POS` is the only per-lap position that exists anywhere in
//     this project; 2020–2024 has none.

import { cellText, splitTables, tableRows } from '../lib/html.js';

export const LT_PARSER_ID = 'livetime/race-report/html';

const BRANDS = {
  yamaha: 'Yamaha',
  honda: 'Honda',
  kawasaki: 'Kawasaki',
  suzuki: 'Suzuki',
  ktm: 'KTM',
  husqvarna: 'Husqvarna',
  hqv: 'HQV',
  gasgas: 'GASGAS',
  triumph: 'Triumph',
  beta: 'Beta',
  fantic: 'Fantic',
  cobra: 'Cobra',
  stark: 'Stark',
  tm: 'TM',
  ducati: 'Ducati',
};

/** `2:05.182` → 125182, `2:04` → 124000, `---` / blank → null. */
export function parseLtTime(text) {
  const match = String(text ?? '').trim().match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const fraction = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
  return (Number(match[1]) * 60 + Number(match[2])) * 1000 + fraction;
}

/** A gap cell is `7.917` (seconds), `+1:44.995`, or a lapped rider's `1 Lap`. */
export function parseGapCell(text) {
  const value = String(text ?? '').trim();
  if (!value || /lap/i.test(value) || /^(DNF|DNS|DSQ|DSNP)$/i.test(value)) return null;
  const plain = value.match(/^\+?(\d+(?:\.\d{1,3})?)$/);
  if (plain) return Math.round(Number(plain[1]) * 1000);
  return parseLtTime(value.replace(/^\+/, ''));
}

/** `3rd` → 3, `--` → null. */
export function parsePosition(text) {
  const match = String(text ?? '').trim().match(/^(\d+)(?:st|nd|rd|th)?$/i);
  return match ? Number(match[1]) : null;
}

function brandFromCell(cell) {
  const src = String(cell?.html ?? '').match(/manufacturers\/[^"'/]*\/?([A-Za-z0-9_-]+)\.(?:png|jpe?g|svg|webp)/i);
  const slug = src?.[1]?.toLowerCase();
  if (slug) return BRANDS[slug] ?? slug.toUpperCase();
  return cell?.text || '';
}

function columnIndex(header, names) {
  const upper = header.map((cell) => cell.text.toUpperCase());
  for (const name of names) {
    const index = upper.findIndex((text) => text.startsWith(name));
    if (index >= 0) return index;
  }
  return -1;
}

function headerFor(table) {
  const rows = tableRows(table);
  const header = rows[0] ?? [];
  const looksLikeResults =
    columnIndex(header, ['RIDER']) >= 0 &&
    columnIndex(header, ['BEST LAP']) >= 0 &&
    (columnIndex(header, ['INTERVAL']) >= 0 || columnIndex(header, ['POS']) >= 0);
  return looksLikeResults ? header : null;
}

function columnsFor(header) {
  return {
    pos: columnIndex(header, ['POS']),
    plate: columnIndex(header, ['#']),
    bike: columnIndex(header, ['BIKE']),
    rider: columnIndex(header, ['RIDER']),
    interval: columnIndex(header, ['INTERVAL']),
    best: columnIndex(header, ['BEST LAP']),
    total: columnIndex(header, ['TOTAL TIME']),
    hometown: columnIndex(header, ['HOMETOWN']),
    team: columnIndex(header, ['TEAM']),
  };
}

function bestLap(cell) {
  const text = cell?.text ?? '';
  const time = text.match(/(\d{1,2}:\d{2}(?:\.\d{1,3})?)/);
  const lap = text.match(/\((\d+)\)/);
  return { ms: time ? parseLtTime(time[1]) : null, lap: lap ? Number(lap[1]) : null };
}

function lapsFromBlock(block) {
  const table = splitTables(block).find((candidate) => {
    const header = tableRows(candidate)[0] ?? [];
    return header.some((cell) => /^LAP TIME/.test(cell.text.toUpperCase()));
  });
  if (!table) return [];

  const rows = tableRows(table);
  const header = rows[0];
  const lapIndex = columnIndex(header, ['#']);
  const timeIndex = columnIndex(header, ['LAP TIME']);
  const posIndex = columnIndex(header, ['POS']);

  const laps = [];
  for (const row of rows.slice(1)) {
    const lap = Number(row[lapIndex]?.text);
    const timeMs = parseLtTime(row[timeIndex]?.text);
    if (!Number.isInteger(lap) || lap < 1) continue;
    laps.push({ lap, timeMs, position: posIndex >= 0 ? parsePosition(row[posIndex]?.text) : null });
  }
  return laps.sort((a, b) => a.lap - b.lap);
}

/**
 * Parse one race report. `meta` supplies what the page does not say reliably:
 * the class and moto number come from the event hub's own link label.
 *
 * @returns {{parser: string, riders: Array<object>, warnings: string[]}}
 */
export function parseMotoReport(html, meta = {}) {
  const warnings = [];
  const tables = splitTables(html);
  const table = tables.find((candidate) => headerFor(candidate));
  if (!table) throw new Error('lt: no results table');
  const cols = columnsFor(headerFor(table));

  const blocks = String(html).split(/(?=<tr\b[^>]*id="driver_id_\d+")/i).slice(1);
  if (blocks.length === 0) throw new Error('lt: no rider blocks');

  const riders = blocks.map((block) => {
    const rowHtml = block.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i)?.[1] ?? '';
    const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => ({
      html: cell[1],
      text: cellText(cell[1]),
    }));
    const at = (index) => (index >= 0 ? cells[index] : undefined) ?? { html: '', text: '' };

    const interval = at(cols.interval).text;
    const laps = lapsFromBlock(block);
    const best = bestLap(at(cols.best));

    // `INTERVAL` is not laps completed: the winner shows `17 Laps`, a lapped rider
    // shows how many laps *down* (`1 Lap`, `13 Laps`). `TOTAL TIME` is `laps/time`
    // and is the only field that states how far the rider actually went.
    const total = at(cols.total).text.match(/^(\d+)\s*\//);
    const gapMs = parseGapCell(interval);

    return {
      pos: parsePosition(at(cols.pos).text),
      plate: Number(at(cols.plate).text.replace(/\D+/g, '')),
      name: at(cols.rider).text,
      bike: brandFromCell(at(cols.bike)),
      hometown: at(cols.hometown).text || null,
      team: at(cols.team).text || null,
      interval: interval || null,
      lapsCompleted: total ? Number(total[1]) : null,
      gapMs,
      status: /^(DNF|DNS|DSQ|DSNP)$/i.test(interval) ? interval.toUpperCase() : null,
      bestLapMs: best.ms,
      bestLapNumber: best.lap,
      laps,
    };
  });

  for (const rider of riders) {
    if (!Number.isInteger(rider.pos) || rider.pos < 1) {
      throw new Error(`lt: rider ${rider.name || '(no name)'} has no result position`);
    }
    if (!Number.isInteger(rider.plate) || rider.plate < 1) {
      throw new Error(`lt: rider ${rider.name} at position ${rider.pos} has no plate`);
    }
    if (!rider.name) throw new Error(`lt: rider at position ${rider.pos} has no name`);
    if (rider.laps.length === 0) warnings.push(`#${rider.plate}: no lap times listed`);
    const numbered = rider.laps.map((lap) => lap.lap);
    if (new Set(numbered).size !== numbered.length) {
      throw new Error(`lt: duplicate lap number for #${rider.plate}`);
    }
  }

  return {
    parser: LT_PARSER_ID,
    class: meta.className ?? null,
    moto: meta.moto ?? null,
    riders,
    warnings,
  };
}

/**
 * Triple Crown `Overall Results` (`view_multi_main_result`):
 *
 *   POS | # | BIKE | RIDER | MOTO 1 | MOTO 2 | MOTO 3 | TOTAL POINTS
 *    1  | 41|      | NATE THRASHER | 3 | 3 | 2 | 8
 *
 * `TOTAL POINTS` is the Olympic sum of the three finishing positions, not a
 * championship award, so it is not stored as `points`. The classification is the
 * round's finishing order and the derived table scores it; the page prints no lap
 * times, so those rounds carry none.
 */
export function parseOverallReport(html, meta = {}) {
  const table = splitTables(html).find((candidate) => {
    const header = tableRows(candidate)[0] ?? [];
    return columnIndex(header, ['RIDER']) >= 0 && columnIndex(header, ['TOTAL POINTS']) >= 0;
  });
  if (!table) throw new Error('lt: no overall results table');
  const header = tableRows(table)[0];
  const cols = columnsFor(header);

  const riders = [];
  for (const row of tableRows(table).slice(1)) {
    const pos = parsePosition(row[cols.pos]?.text);
    const plate = Number(String(row[cols.plate]?.text ?? '').replace(/\D+/g, ''));
    if (!Number.isInteger(pos) || pos < 1 || !Number.isInteger(plate) || plate < 1) continue;
    riders.push({
      pos,
      plate,
      name: row[cols.rider]?.text ?? '',
      bike: brandFromCell(row[cols.bike]),
      hometown: null,
      team: null,
      status: null,
      gapMs: null,
      lapsCompleted: null,
      bestLapMs: null,
      laps: [],
    });
  }

  if (riders.length === 0) throw new Error('lt: overall table had no rows');
  return {
    parser: LT_PARSER_ID,
    class: meta.className ?? null,
    moto: 1,
    riders,
    warnings: ['overall results: no per-lap times printed'],
  };
}

/** Combined qualifying ranking: `POS | # | BIKE | RIDER | BEST LAP | GAP | DIFF | …` */
export function parseQualifyingReport(html, meta = {}) {
  const table = splitTables(html).find((candidate) => {
    const header = tableRows(candidate)[0] ?? [];
    return columnIndex(header, ['RIDER']) >= 0 && columnIndex(header, ['BEST LAP']) >= 0;
  });
  if (!table) throw new Error('lt: no qualifying table');
  const header = tableRows(table)[0];
  const cols = columnsFor(header);

  const rows = [];
  for (const row of tableRows(table).slice(1)) {
    const pos = parsePosition(row[cols.pos]?.text);
    const plate = Number(String(row[cols.plate]?.text ?? '').replace(/\D+/g, ''));
    if (!Number.isInteger(pos) || pos < 1 || !Number.isInteger(plate) || plate < 1) continue;
    rows.push({
      pos,
      plate,
      name: row[cols.rider]?.text ?? '',
      bike: brandFromCell(row[cols.bike]),
      hometown: row[cols.hometown]?.text || null,
      team: row[cols.team]?.text || null,
      bestMs: parseLtTime(row[cols.best]?.text),
      sessions: [],
    });
  }

  if (rows.length === 0) throw new Error('lt: qualifying table had no rows');
  return { parser: LT_PARSER_ID, class: meta.className ?? null, rows, warnings: [] };
}
