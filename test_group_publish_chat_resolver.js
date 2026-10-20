const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');
assert.match(
  source,
  /chat && chat\.isGroup && \(Array\.isArray\(chat\.participants\) \|\| typeof chat\.sendMessage === "function"\)/,
  'group publishing must accept a valid sendable group without a loaded participants array',
);
assert.match(
  source,
  /if \(!chat \|\| !chat\.isGroup \|\| typeof chat\.sendMessage !== "function"\) return res\.status\(503\)/,
  'publish route must still require a real group and sendMessage capability',
);
console.log('group publish resolver compatibility guard passed');
