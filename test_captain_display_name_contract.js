const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const admin = fs.readFileSync('admin.html', 'utf8');

assert.match(
  server,
  /displayName: captainDisplayName\(row\.name \|\| row\.registration_name\)/,
  'captain API displayName must prefer the current editable name'
);
assert.doesNotMatch(
  server,
  /displayName: captainDisplayName\(row\.registration_name \|\| row\.name\)/,
  'captain API must not prefer stale registration_name for displayName'
);
assert.match(
  server,
  /captainDisplayName\(captain\.name \|\| captain\.registration_name\)/,
  'captain preview names must prefer the current name'
);
assert.match(
  admin,
  /function captainUiName\(c\)\{const value=c\?\.name\|\|c\?\.displayName\|\|c\?\.registrationName/,
  'classic admin panel must define a canonical current-name display helper'
);
assert.match(admin, /const name=captainUiName\(c\);/, 'negative/archive rows must use the canonical name');
assert.match(admin, /const registrationName=captainUiName\(c\);/, 'captain table rows must use the canonical name');
assert.doesNotMatch(
  admin,
  /const (?:name|registrationName)=c\.registrationName\|\|c\.name\|\|c\.displayName/,
  'classic admin panel must not prefer registrationName for visible captain names'
);
assert.match(admin, /<th>اسم الكابتن<\/th>/, 'captain table must label the visible field as current captain name');

console.log('captain display-name contract verified');
