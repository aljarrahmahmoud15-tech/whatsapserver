const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const start = server.indexOf('const HTTP_SLOW_REQUEST_THRESHOLD_MS = 1000;');
assert.notEqual(start, -1, 'slow-request threshold must be explicit');
const end = server.indexOf('app.use("/api",', start);
assert.notEqual(end, -1, 'slow-request logger must be installed before API routes');
const logger = server.slice(start, end);

assert.match(logger, /res\.once\("finish"/);
assert.match(logger, /durationMs < HTTP_SLOW_REQUEST_THRESHOLD_MS/);
assert.match(logger, /const originalWriteHead = res\.writeHead/);
assert.match(logger, /res\.setHeader\("Server-Timing", `app;dur=/);
assert.match(logger, /res\.hasHeader\("Server-Timing"\)/);
assert.match(logger, /req\.route\?\.path/);
assert.match(logger, /\[HttpPerf\]/);
assert.doesNotMatch(logger, /req\.(?:query|body|headers)/, 'logger must not record query strings, request bodies, or headers');

console.log('slow HTTP request logging privacy and threshold guardrails: PASS');
