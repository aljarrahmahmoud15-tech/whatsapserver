const assert = require('node:assert/strict');
const fs = require('node:fs');
const index = fs.readFileSync('./public/index.html', 'utf8');
const captain = fs.readFileSync('./public/captain.html', 'utf8');
for (const html of [index, captain]) {
  assert.match(html, /السعر \[القيمة\]/);
  assert.match(html, /اقتباس|بدونه/);
  assert.match(html, /تم/);
  assert.match(html, /👍/);
  assert.match(html, /لا حاجة لكتابة الوقت أو من وإلى|لا تكتب الوقت أو نقطة الانطلاق أو الوجهة/);
}
assert.match(index, /id="order-format-title"/);
assert.match(captain, /id="captain-order-format-title"/);
console.log('order format UI guardrails verified');
