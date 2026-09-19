const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /const quotedReply = pending\.acceptance_message_id === messageId/);
assert.match(source, /target\.hasQuotedMsg && typeof target\.getQuotedMessage === "function"/);
assert.match(source, /const quotedReplyIsOrder = Boolean\(quotedReply && parseOrder\(quotedReply\.body\)\?\.isOrder && quotedReplyId === pending\.source_message_id\)/);
assert.match(source, /if \(!quotedReplyIsOrder\)/);
assert.match(source, /reaction_target_not_selected_quoted_reply/);
assert.doesNotMatch(source, /void sendBotText\(target\.from, finalBookingCancellationText\(\)\)/, 'لا ترسل رسالة إلغاء قبل تثبيت الحجز');

console.log('selected quoted reply reaction guardrails verified without pre-confirmation messaging');
