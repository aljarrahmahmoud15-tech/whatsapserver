'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('./server.js', 'utf8');
const captain = fs.readFileSync('./public/captain.html', 'utf8');

assert.match(server, /app\.post\("\/api\/captain\/redeem-card", requireCaptain/);
assert.match(server, /إضافة الرصيد تتم من المالك فقط/);
assert.doesNotMatch(captain, /redeem-card/);
assert.match(captain, /إضافة الرصيد من المالك فقط/);
assert.match(captain, /لا توجد بطاقات شحن أو تفعيل ذاتي/);
assert.match(captain, /إرسال إشعار الموافقة إلى الإدارة/);
console.log('owner-only top-up policy guardrails verified');
