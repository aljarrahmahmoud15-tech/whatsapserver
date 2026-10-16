const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const owner = fs.readFileSync('public/index.html', 'utf8');
const captain = fs.readFileSync('public/captain.html', 'utf8');

assert.match(server, /const COMPANY_BRAND_NAME = "وصلني الآن"/);
assert.match(server, /const COMPANY_BRAND_ENGLISH = "WASLNI NOW"/);
assert.match(server, /`┃ \$\{COMPANY_BRAND_NAME\} \| بوابة التشغيل الرسمية`/);
assert.match(server, /🟢 تثبيت الطلب/);
assert.match(owner, /لوحة الشيخ للتوصيل/);
assert.match(owner, /value="\/captain\?mode=login"/);
assert.match(owner, /\/captain\/register/);
assert.doesNotMatch(owner, /whatsapserver-2|meta-bot|server2/i);
assert.match(captain, /الشيخ للتوصيل/);
assert.doesNotMatch(server, /شركة الجراح \| بوابة التشغيل الرسمية/);
assert.doesNotMatch(server, /AL-JARAH OPERATIONS NETWORK/);
assert.doesNotMatch(owner, /شركة الجراح/);
assert.doesNotMatch(captain, /<strong>الجراح<\/strong>/);

console.log('Aljarah isolation and Sheikh Delivery branding guardrails verified');
