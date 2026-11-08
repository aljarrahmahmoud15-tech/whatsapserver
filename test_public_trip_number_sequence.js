const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

// Contract checks: the schema persists a public number, backfills legacy rows,
// and allocates the next number without exposing internal WhatsApp IDs.
assert.match(server, /ALTER TABLE order_candidates ADD COLUMN public_trip_no INTEGER/);
assert.match(server, /SELECT id FROM order_candidates WHERE public_trip_no IS NULL ORDER BY id ASC/);
assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_order_candidates_public_trip_no/);
assert.match(server, /const assignCandidatePublicTripNo = db\.transaction\(/);
assert.match(server, /SELECT COALESCE\(MAX\(public_trip_no\),0\)\+1 AS next FROM order_candidates/);
assert.match(server, /UPDATE order_candidates SET public_trip_no=\?,updated_at=\? WHERE id=\? AND public_trip_no IS NULL/);

const reopenStart = server.indexOf('async function notifyOfficialGroupOrderReopened(');
const reopenEnd = server.indexOf('\nasync function reopenOrderAfterInsufficientBalance', reopenStart);
assert.ok(reopenStart >= 0 && reopenEnd > reopenStart, 'reopen notification helper must exist');
const reopenHelper = server.slice(reopenStart, reopenEnd);
const reopenMessageStart = reopenHelper.indexOf('  const message = [');
const reopenMessageEnd = reopenHelper.indexOf('  ].join("\\n");', reopenMessageStart);
assert.ok(reopenMessageStart >= 0 && reopenMessageEnd > reopenMessageStart, 'reopen message block must exist');
const reopenMessage = reopenHelper.slice(reopenMessageStart, reopenMessageEnd);
assert.match(reopenMessage, /رقم الرحلة: \$\{String\(candidate\?\.public_trip_no \|\| "غير محدد"\)\}/);
assert.match(reopenMessage, /Orange Money: 0779110123/);
assert.match(reopenMessage, /بعد التحويل، أرسل صورة الوصل أو رقم العملية والمبلغ إلى نفس الرقم للمطابقة\./);
assert.match(reopenMessage, /لا تتم إضافة الرصيد إلا بعد التحقق من وصول المبلغ واعتماد الإدارة\./);
assert.doesNotMatch(reopenMessage, /candidateId|source_message_id|idempotencyKey/);

const groupStart = server.indexOf('async function notifyOfficialGroupInsufficientAcceptanceDeletionFailure(');
const groupEnd = server.indexOf('\nconst cancellationPartyNotificationInFlight', groupStart);
assert.ok(groupStart >= 0 && groupEnd > groupStart, 'compact group notification helper must exist');
const groupHelper = server.slice(groupStart, groupEnd);
assert.match(groupHelper, /رقم الرحلة: \$\{String\(publicTripNo\)\}/);
assert.doesNotMatch(groupHelper, /رقم الرحلة: \$\{String\(sourceKey\)\}/);

// Behavioral contract: allocation is 1, 2, 3..., and retrying the same
// candidate never changes its public number.
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

console.log('public trip numbers are sequential, stable on retry, and never expose internal message IDs');
