const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

test('live producer reaction bypasses background confirmation backoff', () => {
  assert.match(source, /const immediateReaction = options\.immediateReaction === true/);
  assert.match(source, /const retryBlocked = !immediateReaction && \(/);
  assert.match(source, /if \(existing && !finalRecoveryAvailable && retryBlocked\)/);
  assert.match(source, /deliveryMode: "direct", immediateReaction: true/);
  assert.match(source, /CONFIRMATION_RETRY_BACKOFF_MS = 120000/);
});
