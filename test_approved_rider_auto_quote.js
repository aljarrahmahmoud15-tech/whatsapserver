const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, 'public', 'book.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

test('approved rider page keeps independent rider flow and reserves distance pricing for smart rides', () => {
  assert.match(html, /id="map-current-button"/);
  assert.match(html, /data-quick-type="passenger"/);
  assert.match(html, /data-quick-type="order"/);
  assert.match(html, /data-quick-type="full-car"/);
  assert.match(html, /id="origin" name="origin" type="hidden"/);
  assert.match(html, /id="destination" name="destination" type="hidden"/);
  assert.match(html, /id="details-origin-value"/);
  assert.match(html, /id="details-destination-value"/);
  assert.match(html, /id="details-type-value"/);
  assert.match(html, /parseCoordinatePair/);
  assert.match(html, /locationDisplayLabel/);
  assert.match(html, /موقعي الحالي/);
  assert.match(html, /direct-rides\/quote/);
  assert.match(html, /حساب بالكيلومتر فقط/);
  assert.match(html, /طلب راكب مستقل؛ لا يُحتسب بالكيلومتر تلقائيًا/);
  assert.doesNotMatch(html, /special-duration/);
  assert.match(server, /app\.get\("\/ride\.html", v27PageLimiter[\s\S]*?res\.redirect\(302, "\/book\.html"\)/);
  assert.doesNotMatch(server, /app\.get\("\/v27\/pilot\/ride"/);
});
