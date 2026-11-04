// Shared page helpers. Everything is a small pure function so a page script
// reads as: load, pick, render.

export async function load(name) {
  const response = await fetch(`data/${name}.json`);
  if (!response.ok) throw new Error(`could not load data/${name}.json (${response.status})`);
  return response.json();
}

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const num = (value, digits = 0) =>
  Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

export const pct = (value, digits = 2) => (Number.isFinite(value) ? `${value.toFixed(digits)}%` : '—');

export const signed = (value, digits = 2) => {
  if (!Number.isFinite(value)) return '—';
  const text = Math.abs(value).toFixed(digits);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${text}`;
};

export const share = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');

/** `<select>` options from `[{ value, label }]`, with the current value kept if possible. */
export function fillSelect(select, options, preferred) {
  const previous = preferred ?? select.value;
  select.innerHTML = options.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
  if (options.some((option) => String(option.value) === String(previous))) select.value = String(previous);
}

/** Table markup. Cells are trusted strings built by the page, so they may contain markup. */
export function table(headers, rows, { className = '', numeric = [] } = {}) {
  const head = headers
    .map((header, index) => `<th${numeric.includes(index) ? ' class="num"' : ''}>${esc(header)}</th>`)
    .join('');
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map((cell, index) => `<td${numeric.includes(index) ? ' class="num"' : ''}>${cell === null || cell === undefined ? '—' : cell}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table class="${className}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function setHTML(element, html) {
  element.innerHTML = html;
}

export function statBlock(items) {
  return `<div class="stats">${items
    .map(
      (item) =>
        `<div class="stat"><div class="value">${esc(item.value)}</div><div class="label">${esc(item.label)}</div></div>`,
    )
    .join('')}</div>`;
}

/** Season list from a derived file's `coverage.seasons` or `seasons[].season`. */
export function seasonsOf(data) {
  const list = (data.seasons ?? []).map((row) => (typeof row === 'number' ? row : row.season));
  return [...new Set(list)].sort((a, b) => a - b);
}

export function option(value, label = value) {
  return { value, label: String(label) };
}
