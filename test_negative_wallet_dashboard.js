const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('admin.html', 'utf8');

assert.match(html, /id="negativeWalletsCard"/);
assert.match(html, /قائمة المحافظ السالبة/);
assert.match(html, /id="negativeWalletSearch"/);
assert.match(html, /id="negativeWalletSummary"/);
assert.match(html, /id="negativeWallets"/);
assert.match(html, /function renderNegativeWallets\(\)/);
assert.match(html, /Number\.parseFloat\(c\.balance\|\|'0'\)<0/);
assert.match(html, /sort\(\(a,b\)=>Number\.parseFloat\(a\.balance\|\|'0'\)-Number\.parseFloat\(b\.balance\|\|'0'\)\)/);
assert.match(html, /Math\.abs\(total\)\.toFixed\(2\)/);
assert.match(html, /openCaptainProfile\(/);
assert.doesNotMatch(html.slice(html.indexOf('id="negativeWalletsCard"'), html.indexOf('id="captainsCard"')), /adjustCaptainWallet|adjustUserWalletDirect|wallet-adjustment/);
assert.match(html, /id="captainsCard"/);
assert.match(html, /href="#negativeWalletsCard"/);

console.log('negative wallet dashboard list, summary, sorting, search, and read-only actions verified');
