const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /ALTER TABLE order_candidates ADD COLUMN public_trip_no INTEGER/);
assert.match(server, /SELECT id FROM order_candidates WHERE public_trip_no IS NULL ORDER BY id ASC/);
assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_order_candidates_public_trip_no/);
assert.match(server, /const assignCandidatePublicTripNo = db\.transaction\(/);
assert.match(server, /SELECT COALESCE\(MAX\(public_trip_no\),0\)\+1 AS next FROM order_candidates/);
assert.match(server, /UPDATE order_candidates SET public_trip_no=\?,updated_at=\? WHERE id=\? AND public_trip_no IS NULL/);
assert.match(server, /async function notifyCaptainInsufficientAcceptanceBalance/);
assert.match(server, /تم إلغاء الرحلة رقم \$\{String\(publicTripNo \|\| "غير محدد"\)\} فقط/);
assert.match(server, /reopened_without_group_notification/);
assert.doesNotMatch(server, /await notifyOfficialGroupInsufficientAcceptanceDeletionFailure\(/);
assert.doesNotMatch(server, /await notifyOfficialGroupOrderReopened\(/);

const rows = [
  { id: 10, public_trip_no: null },
  { id: 11, public_trip_no: null },
  { id: 12, public_trip_no: 3 },
];
const allocate = (row) => {
  if (Number.isInteger(row.public_trip_no) && row.public_trip_no > 0) return row.public_trip_no;
  const next = Math.max(0, ...rows.map((item) => Number(item.public_trip_no) || 0)) + 1;
  row.public_trip_no = next;
  return next;
};
assert.equal(allocate(rows[0]), 4);
assert.equal(allocate(rows[0]), 4, 'retry must preserve the original public number');
assert.equal(allocate(rows[1]), 5);
assert.equal(allocate(rows[2]), 3, 'existing public number must remain stable');
assert.deepEqual(rows.map((row) => row.public_trip_no), [4, 5, 3]);

const orderedNumbers = [1, 2, 3].map((publicTripNo) => `رقم الرحلة: ${publicTripNo}`);
assert.deepEqual(orderedNumbers, [
  'رقم الرحلة: 1',
  'رقم الرحلة: 2',
  'رقم الرحلة: 3',
]);
assert.ok(orderedNumbers.every((line) => /^رقم الرحلة: [1-9]\d*$/.test(line)));

console.log('public trip numbers are sequential and used only in the captain notice');
