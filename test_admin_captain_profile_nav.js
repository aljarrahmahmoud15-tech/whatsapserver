const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('admin.html', 'utf8');

assert.match(
  html,
  /<a href="#captainsCard" title="اختر كابتنًا ثم افتح ملفه الكامل">ملف الكابتن<\/a>/,
  'quick navigation must lead to the visible captain list'
);
assert.doesNotMatch(
  html,
  /<a href="#captainProfileCard"[^>]*>ملف الكابتن<\/a>/,
  'quick navigation must not target the hidden profile card directly'
);
assert.match(
  html,
  /id="captainProfileCard" class="card hidden"/,
  'profile card must remain hidden until a captain is selected'
);
assert.match(
  html,
  /function openCaptainProfile\(id,name\)/,
  'selected captain profile loader must remain available'
);
assert.match(
  html,
  /onclick="openCaptainProfile\(\$\{Number\(c\.id\)\},'/,
  'each captain row must retain its full-profile action'
);

console.log('admin captain profile navigation guard: PASS');
