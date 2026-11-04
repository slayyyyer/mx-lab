// Rider identity.
//
// Within an event the plate number is the reliable key: the results sheet has
// full names ("Jett Lawrence"), the lap-times sheet has initials
// ("J. Lawrence"), and both carry the plate. Across events the slug is the key.
// Overrides exist because plates change season to season and two riders can
// share a surname; anything ambiguous is fixed in data/overrides/riders.json
// rather than guessed at build time.

import { readFile } from 'node:fs/promises';

export function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * overrides maps a slug we derived to the canonical slug, e.g.
 * { "justin-barcia": "justin-barcia" } for a spelling variant, or
 * { "j-lawrence": "jett-lawrence" } when only the abbreviated name is known.
 */
export function riderId(name, overrides = {}) {
  const slug = slugify(name);
  if (!slug) throw new Error(`rider identity: empty name "${name}"`);
  return overrides[slug] ?? slug;
}

export async function loadOverrides(path = 'data/overrides/riders.json') {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
