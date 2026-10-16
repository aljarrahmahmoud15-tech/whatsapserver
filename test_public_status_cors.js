const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

assert.doesNotMatch(server, /DEFAULT_PUBLIC_REPORT_ORIGIN|waslni-stab-ndpp5c4k/);
assert.match(server, /methods: \["GET", "HEAD", "OPTIONS"\]/);
assert.match(server, /if \(\!\["\/health", "\/status"\]\.includes\(req\.path\)\) return next\(\);/);
assert.match(server, /return publicStatusCors\(req, res, next\);/);
assert.match(server, /const allowed = \[PUBLIC_APP_URL\]\.filter\(Boolean\);/);

console.log('public status CORS guardrails verified');
