// Season roster: `class:plate` -> one rider.
//
// A plate is unique per rider within a class per season, so it is the key. Names
// are not: in 2020–2024 the results sheet lets a long name spill into the next
// column, so one rider turns up as both `lane-shaw` and `lane-shaw-alv`
// (`Lane Shaw         Alv`). Those spellings are folded into the rider with the
// most rows and kept as aliases, so an analysis can still join on the id it saw.
//
// A *different* surname on the same plate is not folded: that is a number
// changing hands mid-season, which the roster must report rather than hide.

import { stableStringify } from './lib/json.js';

const normalizeName = (name) => String(name).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * True when both spellings are the same printed name, one cut short: `Lane Shaw`
 * against `Lane Shaw Alv`, or `Gerhard Matamoros Ho` against `... Hon`. The tail
 * is at most four characters, which is what a truncated neighbouring column
 * looks like — and it is why `Cade Clason` and `William Clason` are not folded.
 */
const isSpill = (a, b) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const tail = long.slice(short.length);
  return tail.length > 0 && tail.length <= 5 && long.startsWith(short);
};

export function createRoster() {
  const plates = new Map();
  return {
    add({ className, plate, riderId, name, eventId }) {
      if (plate === null || plate === undefined || plate === '') {
        throw new Error(`roster: ${className} row without a plate (${riderId})`);
      }
      const key = `${className}:${plate}`;
      if (!plates.has(key)) plates.set(key, new Map());
      const riders = plates.get(key);
      if (!riders.has(riderId)) riders.set(riderId, { name, rows: 0, events: new Set() });
      const rider = riders.get(riderId);
      rider.rows += 1;
      if (eventId) rider.events.add(eventId);
    },

    build() {
      const riders = [];
      const warnings = [];
      for (const [key, variants] of plates) {
        const [className, plateText] = key.split(':');
        const plate = Number(plateText);
        // The dominant spelling wins; a tie goes to the shorter (cleaner) id.
        const ranked = [...variants].sort(
          (a, b) => b[1].rows - a[1].rows || a[0].length - b[0].length || a[0].localeCompare(b[0]),
        );
        const [riderId, canonical] = ranked[0];
        const aliases = [];
        const otherRiders = [];
        const events = new Set(canonical.events);
        for (const [id, variant] of ranked.slice(1)) {
          if (isSpill(normalizeName(canonical.name), normalizeName(variant.name))) {
            aliases.push(id);
            for (const eventId of variant.events) events.add(eventId);
          } else {
            // A number that changed hands mid-season: both riders are real, so
            // both stay on the entry instead of one being folded into the other.
            otherRiders.push(id);
            warnings.push(
              `${className} #${plate}: ${riderId} (${canonical.rows} rows) and ${id} (${variant.rows} rows) are different riders`,
            );
          }
        }
        riders.push({
          class: className,
          plate,
          riderId,
          name: canonical.name,
          events: events.size,
          aliases: aliases.sort(),
          otherRiders: otherRiders.sort(),
        });
      }
      riders.sort((a, b) => (a.class === b.class ? a.plate - b.plate : a.class.localeCompare(b.class)));
      return { riders, warnings: warnings.sort() };
    },
  };
}

/** The roster file, with its keys in a fixed order so a rebuild is byte-identical. */
export function rosterFile({ season, source, eventCount, riders, warnings }) {
  return stableStringify({ eventCount, riders, season, source, warnings });
}
