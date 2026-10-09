const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

assert.match(
  server,
  /const readOnlyRequest = \["GET", "HEAD", "OPTIONS"\]\.includes\(String\(req\.method \|\| ""\)\.toUpperCase\(\)\);/
);
assert.match(
  server,
  /if \(!readOnlyRequest && !consumeRateLimit\(apiRate, clientAddress\(req\), API_RATE_LIMIT_MAX\)\)/
);
assert.match(server, /app\.use\("\/api", \(req, res, next\) => \{/);
console.log('API rate-limit guard verified: read-only requests do not consume the mutation quota');
