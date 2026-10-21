// The V26 "approve after review" button posted to /api/admin/orders/open?focus=<id>/confirm,
// a path the server never registered, so the button answered 404 and stayed dead. It must now
// target the real candidate confirm route with the same payload as V27.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const v26 = fs.readFileSync(path.join(__dirname, 'public', 'admin-v26.html'), 'utf8');
const v27 = fs.readFileSync(path.join(__dirname, 'public', 'admin-v27.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

const realCall = "api('/api/admin/unconfirmed-bookings/candidate/'+encodeURIComponent(id)+'/confirm',";
const deadCall = "api('/api/admin/orders/open?focus='+encodeURIComponent(id)+'/confirm',";

assert.ok(v26.includes(realCall), 'v26 must call the real approve route');
assert.ok(!v26.includes(deadCall), 'v26 must not call the dead orders/open confirm path');
assert.ok(v27.includes(realCall), 'v27 must keep calling the real approve route');
assert.match(v26, /candidate\/'\+encodeURIComponent\(id\)\+'\/confirm',\{method:'POST',body:JSON\.stringify\(\{sourceMessageId:booking\.sourceMessageId,acceptanceMessageId:booking\.acceptanceMessageId\}\)\}/, 'v26 payload must match the handler inputs');
assert.match(server, /app\.post\("\/api\/admin\/unconfirmed-bookings\/candidate\/:id\/confirm", requireAdmin/, 'server route must stay registered');
// the other orders/open calls in the panel are legitimate reads and must stay
assert.ok(v26.includes("api('/api/admin/orders/open?summary=1')"), 'the orders/open summary read must stay');

console.log('Approve-route guard verified: V26 and V27 both target the real candidate confirm route with the same payload');
