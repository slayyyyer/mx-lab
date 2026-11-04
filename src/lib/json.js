// Deterministic JSON: object keys sorted, fixed 2-space indent, one trailing newline.
// The dataset is committed, so re-running the build must not produce a diff.
// Non-finite numbers are an error rather than `null`, because a silent `null`
// hides a parse failure in a field that is supposed to hold a measurement.

export function stableStringify(value) {
  return `${render(value, 0)}\n`;
}

function render(value, depth) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`refusing to serialise non-finite number: ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = '  '.repeat(depth + 1);
    const items = value.map((item) => pad + render(item, depth + 1));
    return `[\n${items.join(',\n')}\n${'  '.repeat(depth)}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return '{}';
    const pad = '  '.repeat(depth + 1);
    const items = keys.map((key) => `${pad}${JSON.stringify(key)}: ${render(value[key], depth + 1)}`);
    return `{\n${items.join(',\n')}\n${'  '.repeat(depth)}}`;
  }
  throw new Error(`refusing to serialise value of type ${typeof value}`);
}
