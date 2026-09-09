const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('./public/join.html', 'utf8');
assert.ok(source.includes('id="accessBackdrop"'), 'private access drawer exists');
assert.ok(source.includes('id="joinBtn"'), 'yellow entry button exists');
assert.ok(source.includes('href="/captain/register"'), 'captain registration link exists');
assert.ok(source.includes('href="/captain"'), 'captain login link exists');
assert.ok(source.includes('href="./support.html"'), 'rider/support link exists');
assert.ok(source.includes('id="copyGroup"'), 'group link copy action exists');
assert.ok(source.includes('id="network-info"'), 'network information anchor exists');
assert.ok(source.includes('document.addEventListener(\'keydown\''), 'escape closes the drawer');
assert.ok(source.includes("document.body.style.overflow='hidden'"), 'drawer locks background scroll');
console.log('portal access drawer guardrails verified');
