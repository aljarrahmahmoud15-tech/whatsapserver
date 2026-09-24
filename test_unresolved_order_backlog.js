const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');

assert.match(source, /CREATE TABLE IF NOT EXISTS unresolved_order_messages/);
assert.match(source, /function recordUnresolvedOrderMessage\(/);
assert.match(source, /async function recoverUnresolvedOrderMessages\(groupId\)/);
assert.match(source, /recordUnresolvedOrderMessage\(\{\n        messageId,/);
assert.match(source, /lastUnresolvedOrderRecovery = \{ startedAt/);
assert.match(source, /unresolvedOrderRecovery: lastUnresolvedOrderRecovery/);
assert.match(source, /Math\.min\(WHATSAPP_REACTION_SCAN_LIMIT, WHATSAPP_RECOVERY_BATCH_LIMIT\)/);
assert.match(source, /pagesScanned: 0/);
assert.match(source, /messagesFetched: 0/);
assert.match(source, /const maxPages = 6/);
assert.match(source, /const WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS =/);
assert.match(source, /withTimeout\(resolveReadableGroupChat\(groupId\), WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS, null\)/);
assert.match(source, /fetchGroupOrderScanBatch\(groupId, \{ before, cutoff, batch: 10, includeOutgoing: true \}\)/);
assert.match(source, /withTimeout\(fetchGroupOrderScanBatch\(groupId, \{ before, cutoff, batch: 10, includeOutgoing: true \}\), WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS \+ 10000/);
assert.match(source, /if \(!fastScan\.nextCursor \|\| !pageMessages\.length\) break/);
assert.match(source, /lastAcceptanceRecovery\.lastStage = "group_scan_timeout"/);
assert.match(source, /scanMessages\.slice\(0, WHATSAPP_RECOVERY_BATCH_LIMIT \* 6\)/);
assert.doesNotMatch(source, /recordUnresolvedOrderMessage\(\{[\s\S]{0,500}financial/);

console.log('unresolved order backlog and bounded recovery guardrails verified');
