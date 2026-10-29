const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('./server.js', 'utf8');
const start = source.indexOf('const groupSnapshotFlights = new Map();');
const end = source.indexOf('async function readGroupSnapshot', start);
assert.ok(start >= 0 && end > start, 'single-flight helper must be defined before readGroupSnapshot');

const context = { setTimeout, clearTimeout, result: null };
vm.runInNewContext(`${source.slice(start, end)}\nresult = { createGroupSnapshotFlight, groupSnapshotFlights };`, context);
const { createGroupSnapshotFlight, groupSnapshotFlights } = context.result;

let evaluations = 0;
let resolveEvaluation;
async function main() {
  const first = createGroupSnapshotFlight('generation:official-group', () => {
    evaluations += 1;
    return new Promise((resolve) => { resolveEvaluation = resolve; });
  });
  const second = createGroupSnapshotFlight('generation:official-group', () => {
    evaluations += 1;
    return Promise.resolve({ ok: true });
  });

  assert.strictEqual(first, second, 'concurrent reads must share one flight');
  assert.equal(groupSnapshotFlights.size, 1, 'one in-flight entry must be retained');
  assert.equal(evaluations, 0, 'evaluation starts asynchronously after the flight is registered');
  await Promise.resolve();
  assert.equal(evaluations, 1, 'one underlying evaluation must start after the microtask');

  resolveEvaluation({ ok: true, snapshot: { participants: [] } });
  const [a, b] = await Promise.all([first.timed, second.timed]);
  assert.deepEqual(a, b, 'all callers must receive the same settled result');
  assert.equal(evaluations, 1, 'only one underlying page evaluation may run');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(groupSnapshotFlights.size, 0, 'flight must be removed after the underlying evaluation settles');
  console.log('group hydration single-flight guardrail verified');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
