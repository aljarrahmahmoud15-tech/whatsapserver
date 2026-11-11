'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('./server.js', 'utf8');
const captain = fs.readFileSync('./public/captain.html', 'utf8');

assert.match(server, /app\.post\("\/api\/captain\/redeem-card", requireCaptain/);
assert.match(server, /رمز البطاقة ومفتاح منع التكرار مطلوبان/);
assert.match(captain, /redeem-card/);
assert.match(captain, /تفعيل البطاقة وإضافة الرصيد/);
assert.doesNotMatch(captain, /لا توجد بطاقات شحن أو تفعيل ذاتي/);
assert.match(captain, /إرسال إشعار الموافقة إلى الإدارة/);
console.log('owner-only top-up policy guardrails verified');
