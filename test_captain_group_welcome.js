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
  assert.match(source, /renderCaptainWelcomeCardMedia\(name, process\.env\.PUBLIC_BASE_URL \|\| "", phone, groupInviteUrl\)/);
  assert.match(source, /sendWhatsAppAtMostOnce\(recipient, media, \{ caption: message \}/);
  assert.match(source, /رقم هاتف الكابتن للنسخ/);
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
  assert.match(source, /shield-border/);
  assert.match(source, /glass/);
  assert.match(source, /ترحيب وتعليمات التشغيل فقط/);
  assert.match(source, /alezwa-captain-welcome-card\.png/);
});

test('direct welcome test is owner-confirmed, idempotent, allowlisted, and wallet-neutral', () => {
  assert.match(source, /app\.post\("\/api\/admin\/send-captain-welcome-direct-test", requireAdmin/);
  assert.match(source, /req\.body\?\.confirm !== true/);
  assert.match(source, /isServer2OutboundTargetAllowed\(chatId\)/);
  assert.match(source, /registerAdminSend\(\{ operationId, chatId, message \}\)/);
  assert.match(source, /mutation: "none", walletChanged: false/);
  assert.match(source, /renderCaptainWelcomeCardMedia\(displayName, PUBLIC_APP_URL, phone, groupInviteUrl\)/);
});

test('official group invite support is separate from group identity and validated before storage', () => {
  assert.match(source, /OFFICIAL_GROUP_INVITE_SETTING_KEY = "official_group_invite_url"/);
  assert.match(source, /hostname !== "chat\.whatsapp\.com"/);
  assert.match(source, /app\.get\("\/api\/group-invite"/);
  assert.match(source, /app\.patch\("\/api\/admin\/group\/invite-link", requireOwnerAdmin/);
  assert.match(source, /inviteGroupId !== groupId/);
  assert.match(source, /setSetting\(OFFICIAL_GROUP_INVITE_SETTING_KEY, inviteUrl\)/);
  assert.match(source, /رابط القروب الرسمي/);
});
