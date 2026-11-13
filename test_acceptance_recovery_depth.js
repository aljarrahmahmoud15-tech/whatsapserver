const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('./server.js', 'utf8');

// Owner-approved background bounds preserve data while limiting automatic history.
assert.match(source, /const WHATSAPP_RECOVERY_SCAN_HOURS = boundedEnvironmentInteger\("WHATSAPP_RECOVERY_SCAN_HOURS", 6, 1, 6\);/);
assert.match(source, /const WHATSAPP_RECOVERY_MAX_PAGES = boundedEnvironmentInteger\("WHATSAPP_RECOVERY_MAX_PAGES", 5, 1, 5\);/);
assert.match(source, /const WHATSAPP_RECOVERY_EARLIER_LOADS = boundedEnvironmentInteger\("WHATSAPP_RECOVERY_EARLIER_LOADS", 3, 1, 3\);/);

// Every automatic recovery path must use the shared window/page bounds.
assert.doesNotMatch(source, /const cutoff = Date\.now\(\) - 12 \* 60 \* 60 \* 1000;/);
assert.doesNotMatch(source, /const maxPages = 6;/);
assert.doesNotMatch(source, /loads < 1 &&/);
assert.doesNotMatch(source, /slice\(0, WHATSAPP_RECOVERY_BATCH_LIMIT \* 6\)/);
assert.match(source, /Math\.min\(WHATSAPP_RECOVERY_BATCH_LIMIT \* WHATSAPP_RECOVERY_MAX_PAGES, 200\)/, 'each initial history fallback stays within the response bound');
assert.match(source, /scanMessages\.slice\(0, WHATSAPP_RECOVERY_BATCH_LIMIT \* WHATSAPP_RECOVERY_MAX_PAGES\)/, 'pagination remains bounded by the approved five-page budget');

// Background fallbacks share the fast page budget instead of granting more loads.
assert.match(source, /async function fetchGroupHistory\(groupId, limit, \{ includeOutgoing = false, earlierLoadLimit = WHATSAPP_RECOVERY_EARLIER_LOADS, cacheOnly = false \} = \{\}\)/);
assert.match(source, /const boundedEarlierLoadLimit = cacheOnly \? 0 : Number\.isInteger\(requestedEarlierLoadLimit\)/);
assert.match(source, /const earlierLoadLimit = Number\.isInteger\(Number\(requestedEarlierLoads\)\)\s*\?\s*Math\.max\(0, Math\.min\(12, Number\(requestedEarlierLoads\)\)\)\s*:\s*3;/, 'history callback permits cached-only fallback, manual cap 12 and default 3');
assert.match(source, /fetchGroupHistory\(groupId, Math\.min\(WHATSAPP_RECOVERY_BATCH_LIMIT \* WHATSAPP_RECOVERY_MAX_PAGES, 200\), \{ includeOutgoing: true, earlierLoadLimit: WHATSAPP_RECOVERY_EARLIER_LOADS, cacheOnly: true \}\)/, 'background fallback cannot allocate a second load budget');
assert.match(source, /fetchGroupHistory\(groupId, 200, \{ includeOutgoing: true, earlierLoadLimit: 12 \}\)/, 'manual exact evidence retains its explicit history allowance');
assert.match(source, /Math\.max\(9000, WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS\)/);

// Evidence-based previews and already-settled idempotency remain present.
assert.match(source, /mutation: "none"/);
assert.match(source, /already_settled/);

console.log('acceptance recovery depth guardrails verified');
