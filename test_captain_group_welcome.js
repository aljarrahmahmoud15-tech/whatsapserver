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
  assert.match(source, /renderCaptainWelcomeCardMedia\(name\)/);
  assert.match(source, /sendWhatsAppAtMostOnce\(recipient, media, \{ caption: "ترحيب الكابتن الجديد" \}/);
});

test('welcome instructions accept quoted or unquoted تم and use the captain portal', () => {
  assert.match(source, /باقتباس أو بدونه/);
  assert.match(source, /captainLoginUrl\(baseUrl\)/);
});

test('captain welcome card keeps the explanation inside a green and gold card', () => {
  assert.match(source, /async function renderCaptainWelcomeCardMedia\(name/);
  assert.match(source, /#a7f3d0/);
  assert.match(source, /#34d399/);
  assert.match(source, /#f6c84c/);
  assert.match(source, /ترحيب وتعليمات التشغيل فقط/);
  assert.match(source, /waslni-captain-welcome-card\.png/);
});
