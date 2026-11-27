const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('server.js', 'utf8');

function walletInstructionsFromConfig(configuredText) {
  const start = source.indexOf('const DEFAULT_CAPTAIN_WALLET_TOPUP_INSTRUCTIONS = [');
  const end = source.indexOf('const captainWalletInstructionInFlight', start);
  assert.ok(start >= 0 && end > start, 'wallet instruction configuration block exists');
  const block = source.slice(start, end);
  return vm.runInNewContext(
    `${block}\nCAPTAIN_WALLET_TOPUP_INSTRUCTIONS;`,
    { process: { env: { CAPTAIN_WALLET_TOPUP_INSTRUCTIONS: configuredText } } },
    { timeout: 1000 },
  );
}

async function runGroupInstruction({ groupId, instructions }) {
  const sentMessages = [];
  const sqlStatements = [];
  const audits = [];
  const db = {
    prepare(sql) {
      sqlStatements.push(sql);
      return {
        get() { return null; },
        run() { return { lastInsertRowid: 17, changes: 1 }; },
      };
    },
  };
  const context = {
    CAPTAIN_WALLET_TOPUP_INSTRUCTIONS: instructions,
    captainWalletInstructionInFlight: new Set(),
    db,
    isOfficialGroupTarget: (target) => target === 'approved-group@g.us',
    client: {},
    isReady: true,
    sendWhatsAppAtMostOnce: async (to, text) => {
      sentMessages.push({ to, text });
      return { status: 'sent', message: { id: { _serialized: 'fixture-message' } } };
    },
    now: () => 'fixture-time',
    audit: (...args) => audits.push(args),
  };
  const start = source.indexOf('async function sendCaptainWalletTopupGroupInstructions');
  const end = source.indexOf('\nfunction ownerNotificationPhones()', start);
  assert.ok(start >= 0 && end > start, 'group wallet sender exists');
  const handler = source.slice(start, end);
  const result = await vm.runInNewContext(
    `${handler}\nsendCaptainWalletTopupGroupInstructions({ groupId: ${JSON.stringify(groupId)}, sourceMessageId: 'fixture-source' })`,
    context,
    { timeout: 1000 },
  );
  return { result, sentMessages, sqlStatements, audits };
}

test('wallet instructions use the configured text and retain a safe fallback', () => {
  const configuredText = [
    'Orange Money — Fixture account A — ACCOUNT_ALPHA',
    'Orange Money — Fixture account B — ACCOUNT_BETA',
    'Test receipt-matching instruction',
  ].join('\n');
  const configured = walletInstructionsFromConfig(configuredText);
  assert.equal(configured, configuredText);
  assert.equal((configured.match(/Orange Money/g) || []).length, 2);

  const fallback = walletInstructionsFromConfig('');
  assert.match(fallback, /تواصل مع الإدارة للحصول على بيانات الحساب المعتمد قبل التحويل/);
  assert.match(fallback, /لا تتم إضافة الرصيد إلا بعد التحقق من وصول المبلغ واعتماد الإدارة/);
});

test('captain wallet keyword sends configured instructions only to the approved group without financial mutation', async () => {
  const configuredText = [
    'Orange Money — Fixture account A — ACCOUNT_ALPHA',
    'Orange Money — Fixture account B — ACCOUNT_BETA',
    'Test receipt-matching instruction',
  ].join('\n');
  const instructions = walletInstructionsFromConfig(configuredText);

  const allowed = await runGroupInstruction({ groupId: 'approved-group@g.us', instructions });
  assert.equal(allowed.result.status, 'sent');
  assert.equal(allowed.sentMessages.length, 1);
  assert.equal(allowed.sentMessages[0].to, 'approved-group@g.us');
  assert.equal(allowed.sentMessages[0].text, configuredText);
  assert.equal((allowed.sentMessages[0].text.match(/Orange Money/g) || []).length, 2);
  assert.equal(allowed.sqlStatements.every((sql) => /notifications/i.test(sql)), true);
  assert.equal(allowed.sqlStatements.some((sql) => /UPDATE\s+users\s+SET\s+wallet_cents|INSERT\s+INTO\s+wallet_ledger/i.test(sql)), false);
  assert.equal(allowed.audits[0][3].financialMutation, false);
  assert.equal(allowed.audits[0][3].walletMutation, false);

  const blocked = await runGroupInstruction({ groupId: 'other-group@g.us', instructions });
  assert.equal(blocked.result.status, 'blocked');
  assert.equal(blocked.sentMessages.length, 0);
  assert.equal(blocked.sqlStatements.length, 0);
});

test('wallet trigger wiring remains captain-only and uses the official-group sender', () => {
  assert.match(source, /const captain = findActiveRegisteredUser\(phone\);/);
  assert.match(source, /if \(captain && \/\^\(محفظة\|محفظه\|شحن محفظة\|شحن محفظه\)\$\/\.test\(normalized\)\)/);
  assert.match(source, /async function sendCaptainWalletTopupGroupInstructions\(\{ groupId, sourceMessageId = null \}\)/);
  assert.match(source, /const officialGroupTarget = typeof isOfficialGroupTarget === "function" && isOfficialGroupTarget\(groupId\);/);
  assert.match(source, /if \(officialGroupTarget && groupCaptain && \/\^\(محفظة\|محفظه\|شحن محفظة\|شحن محفظه\)\$\/\.test\(normalizedGroupBody\)/);
  assert.match(source, /await sendCaptainWalletTopupGroupInstructions\(\{ groupId, sourceMessageId:/);
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

test('wallet keyword is captain-only and does not mutate wallet or group state', () => {
  assert.match(source, /const captain = findActiveRegisteredUser\(phone\);/);
  assert.match(source, /if \(captain && \/\^\(محفظة\|محفظه\|شحن محفظة\|شحن محفظه\)\$\/.test\(normalized\)\)/);
  assert.match(source, /async function sendCaptainWalletTopupGroupInstructions\(\{ groupId, sourceMessageId = null \}\)/);
  assert.match(source, /const officialGroupTarget = typeof isOfficialGroupTarget === "function" && isOfficialGroupTarget\(groupId\);/);
  assert.match(source, /if \(officialGroupTarget && groupCaptain && \/\^\(محفظة\|محفظه\|شحن محفظة\|شحن محفظه\)\$\/.test\(normalizedGroupBody\)/);
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
