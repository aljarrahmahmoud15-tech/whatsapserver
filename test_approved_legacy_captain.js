const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');

assert.doesNotMatch(source, /BLOCKED_PHONES[^\n]*962775969880/, 'الرقم الموافق عليه لا يعود إلى قائمة الحظر الثابتة');
assert.match(source, /DELETE FROM blocked_phones WHERE phone=\?/, 'تتم إزالة صف الحظر القديم للرقم عند الإقلاع');
assert.doesNotMatch(
  source,
  /UPDATE users SET active=0, is_bot=0, updated_at=\? WHERE phone=\? AND phone<>\?/,
  'لا يوجد تعطيل تلقائي لحساب الرقم الموافق عليه عند الإقلاع',
);
assert.match(source, /activation remains an explicit admin action/, 'التفعيل النهائي يبقى إجراء Owner صريحًا');

console.log('approved legacy captain guardrails passed');
