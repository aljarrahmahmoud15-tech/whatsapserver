const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const owner = fs.readFileSync('public/index.html', 'utf8');
const captain = fs.readFileSync('public/captain.html', 'utf8');
const forbiddenServiceMarkers = [
  ['whatsapserver', '2'].join('-'),
  ['meta', 'bot'].join('-'),
  ['server', '2'].join(''),
];

assert.match(server, /const COMPANY_BRAND_NAME = "الشيخ للتوصيل"/);
assert.match(server, /const COMPANY_BRAND_ENGLISH = "SHEIKH DELIVERY"/);
assert.match(server, /`┃ \$\{COMPANY_BRAND_NAME\} \| بوابة التشغيل الرسمية`/);
assert.match(server, /🟢 تثبيت الطلب/);
assert.match(owner, /لوحة الشيخ للتوصيل/);
assert.match(owner, /value="\/captain\?mode=login"/);
assert.match(owner, /\/captain\/register/);
assert.ok(forbiddenServiceMarkers.every((marker) => !new RegExp(marker, 'i').test(owner)));
assert.match(captain, /الشيخ للتوصيل/);
const join = fs.readFileSync('public/join.html', 'utf8');
assert.doesNotMatch(join, /\u0627\u0644\u062c\u0631\u0627\u062d/);
assert.doesNotMatch(owner, /\bAljarah\b|\u0627\u0644\u062c\u0631\u0627\u062d/);
assert.doesNotMatch(captain, /Orange Money|FADI|\u0627\u0644\u062c\u0631\u0627\u062d|<strong>\u0627\u0644\u062c\u0631\u0627\u062d<\/strong>/);

console.log('Sheikh Delivery branding and legacy payment guardrails verified');
