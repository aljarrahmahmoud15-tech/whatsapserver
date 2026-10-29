const assert = require('node:assert/strict');
const fs = require('node:fs');
const portal = fs.readFileSync('./public/index.html', 'utf8');
const publicJoin = fs.readFileSync('./public/join.html', 'utf8');
// Zero-copy guardrails: no hardcoded invite link anywhere in panels.
assert.doesNotMatch(portal, /chat\.whatsapp\.com\/[A-Za-z0-9_-]{20,}/, 'لا يوجد رابط دعوة مثبت في لوحة الإدارة');
assert.doesNotMatch(publicJoin, /chat\.whatsapp\.com\/[A-Za-z0-9_-]{20,}/, 'لا يوجد رابط دعوة مثبت في بوابة الانضمام');
assert.match(portal, /let MAIN_WHATSAPP_GROUP_URL='';/, 'رابط الدعوة يُحمّل ديناميكيًا في لوحة الإدارة');
assert.match(portal, /\/api\/admin\/group\/link-state/, 'يُجلب رابط الدعوة من مسار الإدارة المحمي');
assert.match(portal, /id="ops-copy-main-invite"/, 'يوجد زر نسخ رابط الدعوة');
assert.match(portal, /\/api\/admin\/bot\/status/, 'تُحمّل هوية البوت من مسار الإدارة المحمي');
assert.match(portal, /botStatus\?\.group\?\.groupId/, 'يظهر معرف القروب المهيأ حتى قبل اتصال واتساب');
assert.match(portal, /botStatus\?\.bot\?\.phoneDisplay/, 'يظهر رقم البوت من حالة الإدارة');
assert.match(portal, /ops-main-qr/, 'زر QR للبوت الرئيسي موجود في اللوحة');
assert.match(portal, /رابط الدعوة سيظهر بعد مسح QR واتصال البوت/, 'لا يتم تخمين رابط الدعوة قبل اتصال البوت');
assert.match(publicJoin, /\/api\/group-invite/, 'بوابة الانضمام تجلب رابط القروب من المسار العام');
console.log('official group invite link UI verified (dynamic, zero hardcoded links)');
