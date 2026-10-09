const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('admin.html', 'utf8');
assert.match(html, /id="unconfirmedBookingsCard"/);
assert.match(html, /href="#unconfirmedBookingsCard">الحجوزات غير المؤكدة/);
assert.match(html, /id="confirmedOrdersCard"/);
assert.match(html, /href="#confirmedOrdersCard">الطلبات المؤكدة/);
assert.match(html, /id="confirmedSettlementsCard"/);
assert.match(html, /href="#confirmedSettlementsCard">التسويات المؤكدة/);
assert.match(html, /id="unconfirmedBookings"/);
assert.match(html, /id="orders"/);
assert.match(html, /id="settlements"/);

console.log('order list separation guard passed');
