const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const monitor = fs.readFileSync('./.github/workflows/order-flow-monitor.yml', 'utf8');

assert.match(server, /const INDEXEDDB_WARNING_RATIO = 0\.80/);
assert.match(server, /const INDEXEDDB_CRITICAL_RATIO = 0\.90/);
assert.match(server, /const INDEXEDDB_MONITOR_INTERVAL_MS = 5 \* 60 \* 1000/);
assert.match(server, /async function collectWhatsAppStoragePressure\(\)/);
assert.match(server, /navigator\.storage\?\.estimate/);
assert.match(server, /indexedDB\.databases/);
assert.match(server, /function updateWhatsAppStoragePressure\(snapshot\)/);
assert.match(server, /QuotaExceededError\/IndexedDB send failure/);
assert.match(server, /function isWhatsAppStorageSendBlocked\(\)/);
assert.match(server, /function installWhatsAppStorageSendGuard\(instance\)/);
assert.match(server, /WHATSAPP_INDEXEDDB_SEND_PAUSED/);
assert.match(server, /setInterval\(check, INDEXEDDB_MONITOR_INTERVAL_MS\)/);
assert.match(server, /whatsappStoragePressure: \{ \.\.\.whatsappStoragePressure \}/);
assert.match(server, /app\.post\("\/api\/admin\/send", requireAdmin/);
assert.match(server, /storagePressure: \{ \.\.\.whatsappStoragePressure \}/);
assert.doesNotMatch(server, /indexedDB\.deleteDatabase/);
assert.doesNotMatch(server, /rmSync\([^\n]*wwebjs_auth/);
assert.match(monitor, /for attempt in 1 2 3 4 5 6/);
assert.match(monitor, /\.whatsappStoragePressure\.status == "critical"/);
assert.match(monitor, /\.whatsappStoragePressure\.blocked == true/);
assert.match(monitor, /\.whatsappStoragePressure\.status == "normal"/);
assert.match(monitor, /\.whatsappStoragePressure\.status == "warning"/);
assert.match(monitor, /IndexedDB pressure state is not measured yet/);

console.log('IndexedDB storage monitoring and safe send guardrails verified');
