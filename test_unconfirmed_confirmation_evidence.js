const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('./server.js', 'utf8');

const fetchStart = source.indexOf('async function fetchExactGroupEvidenceMessages(groupId, sourceMessageId, acceptanceMessageId)');
const linkStart = source.indexOf('  const linkSourceToAcceptance = (rows) => {', fetchStart);
const linkEnd = source.indexOf('\n  const logged =', linkStart);
assert.ok(fetchStart >= 0 && linkStart > fetchStart && linkEnd > linkStart, 'exact quote linker exists');
const linkerCode = `${source.slice(linkStart, linkEnd)}\nthis.linkSourceToAcceptance = linkSourceToAcceptance;`;
const groupId = 'approved-group@g.us';
const evidenceContext = {
  groupId,
  sourceMessageId: 'source-fixture',
  acceptanceMessageId: 'acceptance-fixture',
  resolveGroupChatId: (message) => String(message?.from || ''),
  serializedMessageId: (message) => message?.id?._serialized || null,
  sourceMessageIdsEqual: (left, right) => String(left || '') === String(right || ''),
  isExactCaptainAcceptance: (text) => String(text || '').trim() === 'تم',
};
vm.runInNewContext(linkerCode, evidenceContext);
const link = evidenceContext.linkSourceToAcceptance;
const sourceMessage = { id: { _serialized: 'source-fixture' }, from: groupId, body: 'السعر 5' };
const noQuoteAcceptance = { id: { _serialized: 'acceptance-fixture' }, from: groupId, body: 'تم' };
const noQuoteResult = link([sourceMessage, noQuoteAcceptance]);
assert.equal(noQuoteResult.length, 0, 'a neighboring stored source row cannot become a quote relationship');
assert.equal(noQuoteAcceptance.__quoted, undefined, 'failed matching does not fabricate __quoted');
assert.equal(noQuoteAcceptance.__quotedMessageId, undefined, 'failed matching does not fabricate a quote id');

const wrongQuoteAcceptance = { id: { _serialized: 'acceptance-fixture' }, from: groupId, body: 'تم', __quotedMessageId: 'other-source-fixture' };
assert.equal(link([sourceMessage, wrongQuoteAcceptance]).length, 0, 'a different quote id is rejected');

const exactQuoteAcceptance = { id: { _serialized: 'acceptance-fixture' }, from: groupId, body: 'تم', __quotedMessageId: 'source-fixture', __quoted: sourceMessage };
const exactQuoteResult = link([sourceMessage, exactQuoteAcceptance]);
assert.equal(exactQuoteResult.length, 2, 'an exact live quote link is retained');
assert.equal(exactQuoteAcceptance.__quotedMessageId, 'source-fixture');

const inspectStart = source.indexOf('async function inspectConfirmedRecoveryMessage');
const authStart = source.indexOf('  const authorizedThumb = botProducer', inspectStart);
const authEnd = source.indexOf('\n  const producer = botProducer', authStart);
assert.ok(inspectStart >= 0 && authStart > inspectStart && authEnd > authStart, 'producer reaction authorization predicate exists');
const authCode = `${source.slice(authStart, authEnd)}\nthis.authorizedThumb = authorizedThumb;`;
function authorizedThumbFor({ botProducer, reactionPresentOnAcceptance, reactionPhones, producerPhone }) {
  const context = {
    botProducer,
    reactionPresentOnAcceptance,
    reactionPhones,
    producerPhone,
    recoveryPhoneMatches: (left, right) => String(left || '') === String(right || ''),
  };
  vm.runInNewContext(authCode, context);
  return context.authorizedThumb;
}
assert.equal(authorizedThumbFor({ botProducer: false, reactionPresentOnAcceptance: true, reactionPhones: ['other-captain-fixture'], producerPhone: 'producer-fixture' }), false, 'a thumbs-up from another sender cannot authorize this producer');
assert.equal(authorizedThumbFor({ botProducer: false, reactionPresentOnAcceptance: true, reactionPhones: ['producer-fixture'], producerPhone: 'producer-fixture' }), true, 'the producer own thumbs-up authorizes the human-owned booking');
assert.equal(authorizedThumbFor({ botProducer: false, reactionPresentOnAcceptance: false, reactionPhones: ['producer-fixture'], producerPhone: 'producer-fixture' }), false, 'an unresolved or absent visible thumbs-up remains unauthorized');

console.log('exact quote relationship and producer-owned 👍 behavior verified in isolated VM fixtures');
