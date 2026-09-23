const assert = require('node:assert/strict');
const fs = require('node:fs');

const script = fs.readFileSync('./safe_single_captain_notification_test.js', 'utf8');
assert.match(script, /const SEND_CONFIRMATION = 'SEND-ONE-CAPTAIN-NOTIFICATION';/);
assert.match(script, /const options = \{ send: false/);
assert.match(script, /DRY_RUN_ONLY/);
assert.match(script, /if \(!options\.send && options\.confirm\)/);
assert.match(script, /if \(options\.send && options\.confirm !== SEND_CONFIRMATION\)/);
assert.match(script, /approval-notification-test/);
assert.match(script, /confirmation: SEND_CONFIRMATION/);
assert.match(script, /idempotencyKey = `\$\{NOTIFICATION_KEY_PREFIX\}-\$\{preview\.id\}`/);
assert.match(script, /walletChanged: false/);
assert.match(script, /mutation: 'none'/);
assert.doesNotMatch(script, /wallet-adjustment|settlePendingOrder|confirm-one/);

console.log('safe single-captain notification test guardrails verified');
