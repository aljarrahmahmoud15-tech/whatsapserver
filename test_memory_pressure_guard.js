const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const index = fs.readFileSync('./public/index.html', 'utf8');

assert.match(server, /WHATSAPP_LID_CACHE_TTL_MS/);
assert.match(server, /WHATSAPP_LID_CACHE_MAX_ENTRIES/);
assert.match(server, /function cacheWhatsappLidPhone\(/);
assert.match(server, /function pruneTimestampedMap\(/);
assert.match(server, /function pruneRuntimeMemoryCaches\(/);
assert.match(server, /pruneTimestampedMap\(whatsappLidPhoneCache/);
assert.match(server, /startRuntimeMemoryCleanup\(\);/);
assert.match(server, /stopRuntimeMemoryCleanup\(\); await destroyClient\(\)/);
assert.match(index, /refreshStatusInFlight/);
assert.match(index, /function scheduleStatusRefresh\(\)/);
assert.match(index, /window\.addEventListener\('pagehide'/);
assert.match(index, /document\.visibilityState==='hidden'/);
assert.doesNotMatch(index, /setInterval\(\(\)=>refreshStatus\(\)\.catch\(\),30000\)/);

console.log('Memory-pressure guard verified: bounded runtime caches and non-overlapping browser status refresh');
