const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('./server.js', 'utf8');
assert.match(source, /acceptance_mode TEXT NOT NULL DEFAULT 'quoted'/);
assert.match(source, /ALTER TABLE order_candidate_acceptances ADD COLUMN acceptance_mode/);
assert.match(source, /UNQUOTED_ACCEPTANCE_WINDOW_MS/);
assert.match(source, /acceptanceMode === "unquoted"/);

const helperStart = source.indexOf('function findUnquotedAcceptanceCandidate(');
const helperEnd = source.indexOf('function findUnquotedOrderMessage(', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'unquoted candidate helper must remain available');

let rows = [];
const context = {
  UNQUOTED_ACCEPTANCE_WINDOW_MS: 10 * 60 * 1000,
  phoneWithCountry: (value) => String(value || '').replace(/^0/, '962'),
  recoveryPhoneMatches: (actual, expected) => String(actual) === String(expected),
  db: { prepare: () => ({ all: () => rows }) },
  Date,
};
vm.runInNewContext(`${source.slice(helperStart, helperEnd)}\nthis.findUnquotedAcceptanceCandidate = findUnquotedAcceptanceCandidate;`, context);

rows = [{ id: 41, producer_phone: '962700000001', created_at: '2026-09-24T04:00:00.000Z' }];
let result = context.findUnquotedAcceptanceCandidate('120363426604560611@g.us', '962700000002', Date.parse('2026-09-24T04:05:00.000Z'));
assert.equal(result.candidate.id, 41, 'a single recent order is safely selected');

rows = [
  { id: 41, producer_phone: '962700000001', created_at: '2026-09-24T04:00:00.000Z' },
  { id: 42, producer_phone: '962700000003', created_at: '2026-09-24T04:01:00.000Z' },
];
result = context.findUnquotedAcceptanceCandidate('120363426604560611@g.us', '962700000002', Date.parse('2026-09-24T04:05:00.000Z'));
assert.equal(result.candidate, null, 'ambiguous unquoted acceptance stays pending');
assert.equal(result.candidates.length, 2);

rows = [{ id: 41, producer_phone: '962700000002', created_at: '2026-09-24T04:00:00.000Z' }];
result = context.findUnquotedAcceptanceCandidate('120363426604560611@g.us', '962700000002', Date.parse('2026-09-24T04:05:00.000Z'));
assert.equal(result.candidate, null, 'the producer cannot accept their own order');

const reactionStart = source.indexOf('async function handleMessageReaction(');
const reactionEnd = source.indexOf('async function reconcileStoredThumbReaction(', reactionStart);
const reactionBody = source.slice(reactionStart, reactionEnd);
assert.match(reactionBody, /const acceptanceMode = pending\.acceptance_mode === "unquoted"/);
assert.match(reactionBody, /!quotedReply \|\| sourceMessageIdsEqual\(quotedReplyId, pending\.source_message_id\)/);
assert.match(source, /acceptanceMode,\n    candidate:/);

console.log('unquoted acceptance guardrails verified');
