const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

assert.match(server, /const DEFAULT_PUBLIC_REPORT_ORIGIN = "https:\/\/waslni-stab-ndpp5c4k\.manus\.space";/);
assert.match(server, /methods: \["GET", "HEAD", "OPTIONS"\]/);
assert.match(server, /if \(\!\["\/health", "\/status"\]\.includes\(req\.path\)\) return next\(\);/);
assert.match(server, /return publicStatusCors\(req, res, next\);/);
assert.match(server, /const allowed = \[CORS_ORIGIN, PUBLIC_REPORT_ORIGIN, DEFAULT_PUBLIC_REPORT_ORIGIN\]\.filter\(Boolean\);/);

console.log('public status CORS guardrails verified');
