const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const source = fs.readFileSync('server.js', 'utf8');

test('group join handler triggers the captain welcome flow only for the configured group', () => {
  assert.match(source, /instance\.on\("group_join", \(notification\) =>/);
  assert.match(source, /isConfiguredGroup\(notification\.chatId\)/);
  assert.match(source, /sendConfiguredGroupCaptainWelcome\(notification\)/);
  assert.match(source, /captain\.group\.welcome/);
});

test('captain welcome is idempotent by normalized phone and does not target owner or bot', () => {
  assert.match(source, /CAPTAIN-GROUP-WELCOME-\$\{phone\}/);
  assert.match(source, /isProtectedOwnerIdentity\(phone\) \|\| isBotPhone\(phone\)/);
  assert.match(source, /\["sent", "delivered", "pending", "uncertain"\]/);
  assert.match(source, /sendWhatsAppAtMostOnce\(recipient, message/);
});

test('welcome instructions accept quoted or unquoted تم and use the captain portal', () => {
  assert.match(source, /باقتباس أو بدونه/);
  assert.match(source, /captainLoginUrl\(baseUrl\)/);
});
