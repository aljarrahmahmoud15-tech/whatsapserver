const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync('./server.js', 'utf8');
const dashboard = fs.readFileSync('./public/index.html', 'utf8');

assert.match(server, /app\.post\("\/api\/admin\/notifications\/daily-debit-cancellation", requireAdmin/);
assert.match(server, /SEND_DAILY_DEBIT_CANCELLATION_NOTICE/);
assert.match(server, /captain\.daily_debit_cancellation_notice\.sent/);
assert.match(server, /تم إلغاء الخصم اليومي بقيمة 10 قروش/);
assert.match(server, /لا يغيّر الاشتراك الأسبوعي أو أي حركة مالية سابقة/);
assert.match(dashboard, /ops-daily-debit-notice/);
assert.match(dashboard, /daily-debit-preview/);
assert.match(dashboard, /daily-debit-send/);
assert.match(dashboard, /إشعار رسمي.*إلغاء الخصم اليومي/);
console.log('daily debit cancellation notice guardrails verified');
