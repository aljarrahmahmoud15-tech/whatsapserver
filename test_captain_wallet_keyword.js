const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

test('captain wallet keyword replies with approved Orange Money instructions', () => {
  assert.match(source, /const CAPTAIN_WALLET_TOPUP_INSTRUCTIONS = \[/);
  assert.match(source, /Orange Money: 0779110123/);
  assert.match(source, /بعد التحويل، أرسل صورة الإيصال أو رقم العملية والمبلغ ورقم حسابك إلى الإدارة للمطابقة/);
  assert.match(source, /لا تتم إضافة الرصيد إلا بعد التحقق من وصول المبلغ واعتماد الإدارة/);
  assert.match(source, /sendCaptainWalletTopupInstructions\(\{ phone, sourceMessageId:/);
  assert.match(source, /captain\.wallet\.topup_instructions/);
});

test('wallet keyword is captain-only and does not mutate wallet or group state', () => {
  assert.match(source, /const captain = findActiveRegisteredUser\(phone\);/);
  assert.match(source, /if \(captain && \/\^\(محفظة\|محفظه\|شحن محفظة\|شحن محفظه\)\$\/.test\(normalized\)\)/);
  assert.match(source, /async function sendCaptainWalletTopupGroupInstructions\(\{ groupId, sourceMessageId = null \}\)/);
  assert.match(source, /isOfficialGroupTarget\(groupId\) && groupCaptain && \/\^\(محفظة\|محفظه\|شحن محفظة\|شحن محفظه\)\$\/.test\(normalizedGroupBody\)/);
  assert.match(source, /group\.captain\.wallet\.topup_instructions/);
  const handlerStart = source.indexOf('async function sendCaptainWalletTopupInstructions');
  const handlerEnd = source.indexOf('function ownerNotificationPhones', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(handler, /UPDATE users SET wallet_cents/);
  assert.doesNotMatch(handler, /INSERT INTO wallet_ledger/);
  assert.doesNotMatch(handler, /sendMessage\([^\n]*@g\.us/);
  assert.match(handler, /financialMutation: false/);
  assert.match(handler, /groupMutation: false/);
  assert.match(handler, /walletMutation: false/);
});
