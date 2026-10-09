const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('./admin.html', 'utf8');
assert.match(admin, /id="officialGroupSyncCard"/, 'official group sync card exists');
assert.match(admin, /const OFFICIAL_GROUP_ID='120363426604560611@g\.us'/, 'official group id is explicit');
assert.match(admin, /\/api\/admin\/diagnostics\/last-group-event/, 'official telemetry is read');
assert.match(admin, /\/api\/admin\/group-messages\?limit=40/, 'official group messages are read with a bounded limit');
assert.match(admin, /setInterval\(\(\)=>void loadOfficialGroupSync\(\),30000\)/, 'official group sync polls every 30 seconds');
assert.match(admin, /لا يوجد فيها إرسال أو تعديل أو حركة مالية/, 'UI declares read-only behavior');
const start = admin.indexOf('async function loadOfficialGroupSync()');
const end = admin.indexOf('\nfunction startOfficialGroupSync', start);
assert.ok(start >= 0 && end > start, 'read-only sync function is present');
const syncSource = admin.slice(start, end);
assert.doesNotMatch(syncSource, /method:\s*['"]POST['"]|sendMessage|\/api\/admin\/send/, 'sync function has no outbound or mutation call');
assert.match(admin, /messageGroup===OFFICIAL_GROUP_ID/, 'message response is exact-match locked');
console.log('official group sync UI guardrails verified');
