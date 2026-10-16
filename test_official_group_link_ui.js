const assert = require('node:assert/strict');
const fs = require('node:fs');

const portal = fs.readFileSync('./public/index.html', 'utf8');
const publicJoin = fs.readFileSync('./public/join.html', 'utf8');

assert.match(portal, /MAIN_WHATSAPP_GROUP_URL=''/, 'واجهة الإدارة لا تحتوي رابط دعوة ثابت');
assert.doesNotMatch(portal, /chat\.whatsapp\.com\//i, 'واجهة الإدارة خالية من روابط دعوة واتساب الثابتة');
assert.match(portal, /id="ops-main-group-invite"/, 'بطاقة القروب موجودة لحالة عدم الربط');
assert.match(portal, /لا يوجد قروب مرتبط حاليًا/, 'الواجهة تعرض حالة عدم وجود قروب');

assert.match(publicJoin, /const GROUP_INVITE_URL = ''/, 'بوابة التسجيل لا تحتوي رابط دعوة ثابت');
assert.doesNotMatch(publicJoin, /chat\.whatsapp\.com\//i, 'بوابة التسجيل خالية من رابط القروب القديم');
assert.match(publicJoin, /لا يوجد رابط قروب مرتبط حاليًا/, 'بوابة التسجيل تعرض عدم توفر رابط القروب');

console.log('unconfigured group UI verified');
