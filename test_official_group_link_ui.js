const assert = require('node:assert/strict');
const fs = require('node:fs');

const portal = fs.readFileSync('./public/index.html', 'utf8');
const publicJoin = fs.readFileSync('./public/join.html', 'utf8');
const expected = 'https://chat.whatsapp.com/EYG2n54rB0QKS54Ltq8XlR';

assert.match(portal, new RegExp(`MAIN_WHATSAPP_GROUP_URL='${expected.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}'`), 'واجهة الإدارة تعرض رابط القروب المعتمد');
assert.match(portal, /id="ops-main-group-invite"\>\$\{esc\(MAIN_WHATSAPP_GROUP_URL\)\}/, 'رابط الدعوة يظهر داخل بطاقة واتساب والقروب');
assert.match(portal, /id="ops-copy-main-invite"/, 'يوجد زر نسخ رابط الدعوة');
assert.match(portal, /id="ops-open-main-invite" href="\$\{MAIN_WHATSAPP_GROUP_URL\}"/, 'يوجد زر فتح رابط الدعوة');
assert.match(publicJoin, new RegExp(expected.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), 'الرابط يطابق رابط القروب العام');

console.log('official group invite link UI verified');
