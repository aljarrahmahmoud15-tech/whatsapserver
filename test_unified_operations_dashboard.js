const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('./public/index.html', 'utf8');

assert.match(html, /data-nav="manual"/);
assert.match(html, /function manual\(\)/);
assert.match(html, /manual-command/);
assert.match(html, /manual-execute/);
for (const action of ['staff', 'orders', 'wallets', 'support', 'reports', 'whatsapp']) {
  assert.match(html, new RegExp(`data-manual-action="${action}"`));
}
assert.match(html, /لا يتم تنفيذ أي إضافة رصيد أو تثبيت طلب أو إرسال جماعي من دون تأكيد صريح/);
assert.match(html, /confirmButton\.dataset\.confirmReady!=='true'/);
assert.match(html, /اضغط مرة ثانية لتنفيذ التسوية/);
assert.match(html, /\/api\/admin\/group\/confirm-one/);
assert.doesNotMatch(html, /سيتم تطبيق التسوية المالية مرة واحدة فقط بعد إعادة التحقق من الأدلة/);
console.log('unified operations dashboard guardrails verified');
