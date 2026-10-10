const assert = require('node:assert/strict');
const fs = require('node:fs');

const portal = fs.readFileSync('./public/index.html', 'utf8');
const publicJoin = fs.readFileSync('./public/join.html', 'utf8');
assert.ok(portal.includes("MAIN_WHATSAPP_GROUP_URL='https://chat.whatsapp.com/FmDpcLJ2wBOJ6B237t9aJz'"), 'واجهة الإدارة تشير إلى رابط قروب Clean المعتمد');
assert.match(portal, /id="ops-copy-main-invite"/, 'الإدارة تتيح نسخ الرابط عند استخدام اللوحة يدويًا');
assert.ok(!publicJoin.includes('chat.whatsapp.com'), 'بوابة Clean العامة لا تنشر رابط دعوة القروب');
assert.ok(!publicJoin.includes('GROUP_INVITE_URL') && !publicJoin.includes('copyGroup'), 'بوابة Clean لا تعرض إجراء نسخ دعوة');
assert.match(publicJoin, /لا تُنشر روابط دعوته عبر هذه البوابة/);

console.log('Clean group invite remains admin-only; public portal publishes no group link');
