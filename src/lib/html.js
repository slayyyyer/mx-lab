// Minimal HTML helpers for the LiveTime report pages.
//
// The pages are server-rendered and regular: every report is a table, and the
// only structure needed is "cells in a row". A real DOM parser would add a
// dependency for behaviour we do not use, and the fragments kept as fixtures are
// extracted text, so the same code reads fixtures and live pages.

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  times: '\u00d7',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    const key = name.toLowerCase();
    if (ENTITIES[key]) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
    return whole;
  });
}

/** Visible text of a cell: tags dropped, whitespace collapsed, entities decoded. */
export function cellText(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tables in document order, each as its inner HTML (nested tables included). */
export function splitTables(html) {
  return String(html)
    .split(/<table\b/i)
    .slice(1)
    .map((chunk) => chunk.split(/<\/table>/i)[0]);
}

/**
 * Rows of a table as `{ html, text }` cells, header row included.
 * @returns {Array<Array<{html: string, text: string}>>}
 */
export function tableRows(tableHtml) {
  return String(tableHtml)
    .split(/<tr\b/i)
    .slice(1)
    .map((row) =>
      [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => ({
        html: cell[1],
        text: cellText(cell[1]),
      })),
    );
}
