const assert = require('assert');
const fs = require('fs');
const server = fs.readFileSync('./server.js', 'utf8');
const index = fs.readFileSync('./public/index.html', 'utf8');
const forbiddenServiceMarkers = [
  ['legacy-service', '2'].join('-'),
  ['meta', 'bot'].join('-'),
  ['external', 'service'].join('-'),
];
assert.match(server, /return `\$\{normalized \|\| PUBLIC_APP_URL\}\/captain\/register`;/);
assert.match(server, /return `\$\{normalized \|\| PUBLIC_APP_URL\}\/captain\?invite=\$\{encodeURIComponent\(inviteToken\)\}`;/);
assert.match(server, /captainLoginUrl\(baseUrl\)/);
assert.match(index, /value="\/captain\?mode=login"/);
assert.match(index, /رابط دخول الكابتن المسجل مباشرة/);
assert.match(index, /\/captain\/register/);
assert.ok(forbiddenServiceMarkers.every((marker) => !new RegExp(marker, 'i').test(index)));
console.log('direct captain registration link guardrails verified');
