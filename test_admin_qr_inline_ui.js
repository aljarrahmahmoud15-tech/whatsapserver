const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('./admin.html', 'utf8');

assert.match(admin, /id="qrSessionCard"/, 'v26 contains an inline QR session card');
assert.match(admin, /id="qrInlineFrame"/, 'v26 contains an inline QR frame');
assert.match(admin, /تجديد QR داخل v26/, 'v26 exposes an inline QR refresh button');
assert.match(admin, /\/api\/admin\/qr-temporary-link/, 'QR link is issued by the protected bot endpoint');
assert.match(admin, /setQrInlineUrl\(q\?\.url\)/, 'only the endpoint URL is passed into the inline QR renderer');
assert.match(admin, /sandbox="allow-same-origin"/, 'inline QR frame is sandboxed');
assert.match(admin, /لا يتم نسخ جلسة قديمة أو كشف رمزها/, 'UI documents that session cloning is not used');
assert.doesNotMatch(admin, /data:image\/png;base64,/, 'no QR payload is embedded in source');

const refreshStart = admin.indexOf('async function refreshQrInline()');
const refreshEnd = admin.indexOf('\nfunction showApp()', refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'inline QR refresh function is present');
const refreshSource = admin.slice(refreshStart, refreshEnd);
assert.match(refreshSource, /api\('\/api\/admin\/qr-temporary-link',\{method:'POST'\}\)/, 'QR issuance remains owner-authenticated');
assert.doesNotMatch(refreshSource, /localStorage\.setItem\([^)]*(?:qr|session|token)/i, 'QR refresh does not persist secrets or session material');

console.log('v26 inline QR session UI guardrails verified');
