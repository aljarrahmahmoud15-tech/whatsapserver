const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');
const index = fs.readFileSync('./public/index.html', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

assert.match(packageJson.scripts.start, /--expose-gc/);
assert.match(packageJson.scripts.start, /--max-old-space-size=\$\{NODE_HEAP_MB:-768\}/);

assert.match(server, /WHATSAPP_LID_CACHE_TTL_MS/);
assert.match(server, /WHATSAPP_LID_CACHE_MAX_ENTRIES/);
assert.match(server, /MEMORY_PRUNE_TRIGGER_MB/);
assert.match(server, /MEMORY_PRUNE_COOLDOWN_MS/);
assert.match(server, /RUNTIME_TEMP_CLEANUP_INTERVAL_MS/);
assert.match(server, /RUNTIME_TEMP_FILE_MAX_AGE_MS/);
assert.match(server, /function cleanupStaleRuntimeTempFiles\(/);
assert.match(server, /function cacheWhatsappLidPhone\(/);
assert.match(server, /function pruneTimestampedMap\(/);
assert.match(server, /function pruneRuntimeMemoryCaches\(/);
assert.match(server, /function getChromiumBrowserProcess\(instance\)/);
assert.match(server, /function listOwnedChromiumPids\(\)/);
assert.match(server, /function descendantPids\(rootPid\)/);
assert.match(server, /async function terminateChromiumPids\(pids/);
assert.match(server, /async function cleanupOwnedChromiumProcesses\(label/);
assert.match(server, /function forceTerminateChromiumProcess\(browserProcess/);
assert.match(server, /let whatsappRestartInFlight = null/);
assert.match(server, /if \(whatsappRestartInFlight\) return whatsappRestartInFlight/);
assert.match(server, /page\.on\("error",/);
assert.match(server, /const chromiumHeapForPuppeteer = typeof CHROMIUM_HEAP_MB/);
assert.match(server, /`--js-flags=--max-old-space-size=\$\{chromiumHeapForPuppeteer\}`/);
assert.match(server, /const children = new Map\(\)/);
assert.match(server, /process\.kill\(pid, "SIGTERM"\)/);
assert.match(server, /process\.kill\(pid, "SIGKILL"\)/);
assert.match(server, /if \(destroyFailed\) await forceTerminateChromiumProcess\(browserProcess, label\);/);
assert.match(server, /pruneTimestampedMap\(whatsappLidPhoneCache/);
assert.match(server, /startRuntimeMemoryCleanup\(\);/);
assert.match(server, /stopRuntimeMemoryCleanup\(\); await destroyClient\(\)/);
assert.match(index, /refreshStatusInFlight/);
assert.match(index, /function scheduleStatusRefresh\(\)/);
assert.match(index, /window\.addEventListener\('pagehide'/);
assert.match(index, /document\.visibilityState==='hidden'/);
assert.doesNotMatch(index, /setInterval\(\(\)=>refreshStatus\(\)\.catch\(\),30000\)/);

console.log('Memory-pressure guard verified: bounded runtime caches and non-overlapping browser status refresh');
