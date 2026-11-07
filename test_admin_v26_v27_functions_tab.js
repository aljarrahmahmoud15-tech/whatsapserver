const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = fs.readFileSync('./admin.html', 'utf8');
const server = fs.readFileSync('./server.js', 'utf8');

assert.match(page, /id="v27FunctionsCard"/);
assert.match(page, /وظائف V27 داخل لوحة البوت/);
assert.match(page, /href="\/admin-v27\.html"/);
assert.match(page, /function loadV27Functions\(\)/);
assert.match(page, /\/api\/admin\/v27\/bootstrap\?fresh=1/);
assert.match(page, /await loadV27Functions\(\)/);
assert.match(server, /app\.get\("\/api\/admin\/v27\/bootstrap", requireAdmin/);
assert.match(server, /mutation: 'none'/);
console.log('V26 V27-functions tab is wired to the authenticated V27 bootstrap without duplicating mutations');
