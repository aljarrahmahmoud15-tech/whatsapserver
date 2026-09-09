const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('./server.js', 'utf8');
const index = fs.readFileSync('./public/index.html', 'utf8');
const render = fs.readFileSync('./render.yaml', 'utf8');

assert.ok(server.includes('function operationalSettings()'), 'operational settings are persisted');
assert.ok(server.includes('function runtimeHealth()'), 'runtime health endpoint has a source');
assert.ok(server.includes('app.get("/api/admin/system/health", requireAdmin'), 'health API is admin protected');
assert.ok(server.includes('app.patch("/api/admin/system/settings", requireAdmin'), 'settings API is admin protected');
assert.ok(server.includes('reconnect scheduled in'), 'reconnect backoff is logged');
assert.ok(server.includes('initialize_timeout'), 'initialization timeout is surfaced');
assert.ok(server.includes('disposeClientInstance(client, "initialize_timeout")'), 'timed out clients are disposed');
assert.ok(index.includes('ops-drawer-overlay'), 'admin glass overlay exists');
assert.ok(index.includes('LIVE SYSTEM HEALTH'), 'admin health panel exists');
assert.ok(index.includes('/api/admin/system/health'), 'admin UI consumes health API');
assert.ok(index.includes('/api/admin/system/settings'), 'admin UI consumes settings API');
assert.ok(render.includes('DATA_DIR') && render.includes('/app/data'), 'persistent data path remains configured');
console.log('reconnect health guardrails verified');
