const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const dashboard = fs.readFileSync('./public/index.html', 'utf8');

assert.match(server, /async function reactToCaptainAcceptance\(message, messageId\)/);
assert.match(server, /if \(producer\.is_bot === 1 \|\| producer\.role === "company"\)/);
assert.match(server, /void reactToCaptainAcceptance\(msg, acceptanceMessageId\)/);
assert.match(server, /await withTimeout\(target\.react\("👍"\), 12000, null\)/);
assert.match(server, /const ADMIN_SEND_TIMEOUT_MS = Math\.max\(5000, Math\.min\(60000, Number\(process\.env\.ADMIN_SEND_TIMEOUT_MS \|\| 20000\)\)\);/);
assert.match(server, /const sendPromise = Promise\.resolve\(\)\.then\(\(\) => client\.sendMessage\(chatId, message\)\);/);
assert.match(server, /sendState: "pending"/);
assert.match(server, /message\.send_pending/);
assert.match(server, /message\.sent_after_timeout/);
assert.match(dashboard, /id="ops-send-order"/);
assert.match(dashboard, /api\('\/api\/admin\/send'/);
assert.match(dashboard, /to:'120363426604560611@g\.us'/);
assert.match(dashboard, /sendState==='pending'/);
assert.match(dashboard, /سيُنشر الطلب باسم البوت\/الشركة/);

console.log('bot producer live-send and reaction guardrails verified');
