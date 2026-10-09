const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('./server.js', 'utf8');

// A busy group pushes the «تم» replies of pending bookings deeper than the old
// 12h / 6-page / single-expansion window, which is why downloaded bookings never
// settled. The recovery scan must stay bounded but reach far enough to find them.
assert.match(source, /const WHATSAPP_RECOVERY_SCAN_HOURS = Math\.max\(1, Math\.min\(168,/);
assert.match(source, /const WHATSAPP_RECOVERY_MAX_PAGES = Math\.max\(1, Math\.min\(40,/);
assert.match(source, /const WHATSAPP_RECOVERY_EARLIER_LOADS = Math\.max\(1, Math\.min\(12,/);

const hoursMatch = source.match(/WHATSAPP_RECOVERY_SCAN_HOURS \|\| (\d+)/);
assert.ok(hoursMatch && Number(hoursMatch[1]) >= 24, 'default recovery window must cover at least a day');
const pagesMatch = source.match(/WHATSAPP_RECOVERY_MAX_PAGES \|\| (\d+)/);
assert.ok(pagesMatch && Number(pagesMatch[1]) > 6, 'default page budget must exceed the old six pages');
const loadsMatch = source.match(/WHATSAPP_RECOVERY_EARLIER_LOADS \|\| (\d+)/);
assert.ok(loadsMatch && Number(loadsMatch[1]) > 1, 'default expansion must exceed the old single load');

// Every recovery path must use the shared bounds instead of the hard-coded 12h window.
assert.doesNotMatch(source, /const cutoff = Date\.now\(\) - 12 \* 60 \* 60 \* 1000;/);
assert.doesNotMatch(source, /const maxPages = 6;/);
assert.doesNotMatch(source, /loads < 1 &&/);
assert.doesNotMatch(source, /slice\(0, WHATSAPP_RECOVERY_BATCH_LIMIT \* 6\)/);

// The deeper in-page expansion still has to stay bounded and time-limited.
assert.match(source, /earlierLoadLimit = Math\.max\(1, Math\.min\(12,/);
assert.match(source, /Math\.max\(9000, WHATSAPP_RECOVERY_PAGE_TIMEOUT_MS\)/);

// Recovery must remain read-only until the owner confirms one booking.
assert.match(source, /mutation: "none"/);
assert.match(source, /already_settled/);

console.log('acceptance recovery depth guardrails verified');
