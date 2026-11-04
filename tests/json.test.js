import { eq, test, assert } from './harness.js';
import { stableStringify } from '../src/lib/json.js';

test('json: keys are sorted so re-runs are byte-identical', () => {
  const a = stableStringify({ b: 1, a: { d: [2, 1], c: 'x' } });
  const b = stableStringify({ a: { c: 'x', d: [2, 1] }, b: 1 });
  eq(a, b);
  assert(a.indexOf('"a"') < a.indexOf('"b"'), 'keys not sorted');
});

test('json: array order is preserved', () => {
  eq(stableStringify([3, 1, 2]), '[\n  3,\n  1,\n  2\n]\n');
});

test('json: one trailing newline', () => {
  const text = stableStringify({ a: 1 });
  assert(text.endsWith('}\n'), 'missing trailing newline');
  assert(!text.endsWith('\n\n'), 'extra newline');
});

test('json: refuses non-finite numbers instead of writing null', () => {
  let threw = false;
  try {
    stableStringify({ a: Number.NaN });
  } catch {
    threw = true;
  }
  assert(threw, 'NaN was serialised');
});
