// A tiny test harness, no dependencies. The handoff asked for an in-repo
// harness rather than a framework, so that `npm test` works with no install.

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed');
}

export function eq(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${message ?? 'values differ'}\n     actual:   ${left}\n     expected: ${right}`);
  }
}

export async function runAll() {
  let failed = 0;
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`ok    ${entry.name}`);
    } catch (error) {
      failed += 1;
      const detail = String(error?.message ?? error).split('\n').join('\n      ');
      console.log(`FAIL  ${entry.name}\n      ${detail}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  return failed === 0;
}
