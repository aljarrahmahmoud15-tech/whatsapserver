const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync('./server.js', 'utf8');
const dashboard = fs.readFileSync('./public/index.html', 'utf8');

const helperStart = server.indexOf('function adminSendMessageMatches');
const helperEnd = server.indexOf('function adminSendResponse', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'message_create matcher exists');
const context = { ADMIN_SEND_OBSERVATION_TIMEOUT_MS: 30000, result: null };
vm.runInNewContext(`${server.slice(helperStart, helperEnd)}\nresult = adminSendMessageMatches;`, context);
const matches = context.result;

const pending = {
  sendState: 'pending',
  chatId: '120363426604560611@g.us',
  message: 'السعر 1 — اختبار حي فقط',
  createdAtMs: 100000,
  observationTimeoutMs: 30000,
};

assert.equal(matches(pending, {
  fromMe: true,
  from: pending.chatId,
  body: pending.message,
  id: { _serialized: '3EB09B1573203D131135C6' },
}, 110000), true, 'exact self message_create confirms the pending send');
assert.equal(matches(pending, {
  fromMe: true,
  to: pending.chatId,
  body: pending.message,
  id: { remote: pending.chatId },
}, 110000), true, 'remote id fallback confirms the pending send');
assert.equal(matches(pending, { fromMe: false, from: pending.chatId, body: pending.message }, 110000), false, 'human message cannot confirm an admin send');
assert.equal(matches(pending, { fromMe: true, from: pending.chatId, body: 'السعر 2' }, 110000), false, 'different body cannot confirm an admin send');
assert.equal(matches(pending, { fromMe: true, from: 'other@g.us', body: pending.message }, 110000), false, 'different chat cannot confirm an admin send');
assert.equal(matches(pending, { fromMe: true, from: pending.chatId, body: pending.message }, 140001), false, 'stale event cannot confirm an admin send');

const sendRoute = server.slice(server.indexOf('app.post("/api/admin/send"'), server.indexOf('function reconcileConfiguredGroupFromEnvironment'));
assert.match(sendRoute, /message\.send_waiting_confirmation/);
assert.match(sendRoute, /\/api\/admin\/send-status\/:operationId/);
assert.match(sendRoute, /serializedMessageId\(sent\)/);
assert.doesNotMatch(sendRoute, /if \(!sent\) \{[\s\S]{0,300}WhatsApp returned no confirmed message/);
assert.match(server, /observeAdminSentMessage\(msg\)/);
assert.match(server, /message\.sent_observed/);
assert.match(dashboard, /api\('\/api\/admin\/send-status\/'\+encodeURIComponent\(operationId\)/);
assert.match(dashboard, /d\.sendState==='observed'/);

console.log('admin send message_create observation guardrails verified');
