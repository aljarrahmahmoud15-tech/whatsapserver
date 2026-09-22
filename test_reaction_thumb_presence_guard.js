const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');
const start = source.indexOf('async function inspectConfirmedRecoveryMessage');
const end = source.indexOf('async function findAutomaticRecoveryEvidence', start);
assert.ok(start >= 0 && end > start, 'recovery inspection helper exists');
const helper = source.slice(start, end);

assert.match(helper, /const rawReactionHint = Boolean\(/, 'raw reaction hint is tracked separately');
assert.match(helper, /const thumbs = .*aggregateEmoji === "👍".*reaction === "👍"/, 'only thumbs-up reactions are eligible');
assert.match(helper, /let reactionPresentOnAcceptance = Boolean\(thumbs\.length\)/, 'generic reaction metadata cannot authorize settlement');
assert.match(helper, /hasVisibleThumbReaction\(acceptanceMessageId\)/, 'visible thumbs-up fallback is used when reaction senders are missing');
assert.match(helper, /if \(botProducer && reactionPresentOnAcceptance\) reactedByBot = true;/, 'company/bot orders still use the verified visible thumbs-up');

console.log('reaction thumb-presence guard verified');
