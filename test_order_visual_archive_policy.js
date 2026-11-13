const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const captain = fs.readFileSync('public/captain.html', 'utf8');

assert.match(server, /const ORDER_DELETION_DISABLED = true/);
assert.match(server, /code: "ORDER_DELETION_DISABLED"/);
assert.match(server, /const archivedTrips = allTrips\.filter/);
assert.match(server, /const trips = allTrips\.filter/);
assert.match(server, /archivedTrips,/);
assert.match(captain, /id="captain-archive-panel"/);
assert.match(captain, /id="archived-trips"/);
assert.match(captain, /data\.archivedTrips/);
assert.match(captain, /مخفي بصريًا/);

console.log('order visual archive policy checks passed');
