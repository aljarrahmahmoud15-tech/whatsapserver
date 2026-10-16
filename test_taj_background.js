const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const asset = path.join(root, 'public', 'taj-app-background.webp');
assert.ok(fs.existsSync(asset), 'Taj background asset exists');
assert.ok(fs.statSync(asset).size > 100_000, 'Taj background asset is not empty');

const pages = [
  'admin.html',
  'public/admin-merged-readonly.html',
  'public/admin-v24.html',
  'public/admin-v26.html',
  'public/admin-v27.html',
  'public/captain.html',
  'public/group-repair.html',
  'public/index.html',
  'public/join.html',
  'public/staff.html',
  'public/support.html',
];

for (const relative of pages) {
  const file = path.join(root, relative);
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(html.includes('id="taj-app-background"'), `${relative} includes Taj background style`);
  assert.ok(html.includes("url('/taj-app-background.webp')"), `${relative} references the local Taj background`);
  assert.ok(!/https?:\/\/[^'\"]*background/i.test(html), `${relative} has no external background URL`);
}

console.log('Taj application background guardrails verified');
