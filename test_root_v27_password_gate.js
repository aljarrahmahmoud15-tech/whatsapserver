const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('./public/index.html', 'utf8');
assert.match(page, /\.app\.admin-ready\{display:flex!important\}/,
  'root V27 app must be hidden until authenticated');
assert.match(page, /lockAdminApp\(\);modal\.hidden=false;/,
  'root V27 must show the password modal on first load');
assert.match(page, /openAdminApp\(\);modal\.hidden=true;/,
  'root V27 must reveal the dashboard only after password login');
assert.doesNotMatch(page, /await refreshOverview\(false\)/,
  'root V27 must not auto-load protected dashboard data on page load');
console.log('root V27 password gate verified');
