const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('./admin.html', 'utf8');
const mergeStart = admin.indexOf('function mergeCaptain');
const mergeEnd = admin.indexOf('async function secureDeleteCaptain', mergeStart);
assert.ok(mergeStart >= 0, 'mergeCaptain must exist');
assert.ok(mergeEnd > mergeStart, 'mergeCaptain boundary must exist');
const mergeFunction = admin.slice(mergeStart, mergeEnd);

assert.doesNotMatch(mergeFunction, /prompt\s*\(/, 'merge flow must not use the browser native prompt');
assert.match(admin, /id="mergeCaptainModal"/, 'in-card merge modal must exist');
assert.match(admin, /id="mergeCaptainInput"/, 'merge modal must have an input');
assert.match(admin, /id="mergeCaptainTitle"/, 'merge modal must have an in-card title');
assert.match(admin, /ID الحساب الهدف/, 'target account label must be inside the card');
assert.match(admin, /#mergeCaptainModal\{[^}]*display:grid/, 'merge modal must be an in-page card overlay');
assert.match(admin, /#mergeCaptainModal \.merge-dialog\{[^}]*color:var\(--text\)/, 'merge card must use the original dashboard text color');
assert.match(admin, /#mergeCaptainModal \.merge-dialog input\{[^}]*color:var\(--text\)/, 'entered text must use the original dashboard text color');
assert.match(admin, /function submitMergeCaptainStep\(\)/, 'merge flow must have an in-card submit handler');
assert.match(admin, /const expected='MERGE '\+mergeCaptainFlow\.sourceId\+' INTO '\+mergeCaptainFlow\.targetId/, 'confirmation phrase must remain exact');

console.log('Admin merge modal guard passed');
