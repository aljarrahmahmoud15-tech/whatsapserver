const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createDirectRideNotificationHub } = require('./direct-ride-notifications');
const { ensureDirectRideSchema, createDirectRideService } = require('./direct-ride-service');

function stream() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.writes = [];
  res.write = (value) => { res.writes.push(String(value)); return true; };
  res.flush = () => {};
  return res;
}

test('SSE hub sends status changes only to the ride and captain audiences', () => {
  const hub = createDirectRideNotificationHub({ heartbeatMs: 60_000 });
  const rider = stream();
  const captain = stream();
  const admin = stream();
  hub.subscribeRide(7, rider, { id: 7, requestCode: 'DR-7', status: 'dispatch_pending', origin: 'A', destination: 'B' });
  hub.subscribeCaptain(4, captain);
  hub.subscribeAdmin(admin);
  hub.publish({
    rideId: 7,
    eventType: 'offered',
    actorRole: 'system',
    details: { captainUserId: 4 },
    createdAt: '2026-10-20T10:00:00.000Z',
    ride: { id: 7, requestCode: 'DR-7', status: 'offered', customerName: 'راكب', phone: '962790000000', origin: 'A', destination: 'B', quotedPrice: '1.61 د.أ', captain: { id: 4, name: 'كابتن' } },
  });
  assert.ok(rider.writes.some((value) => value.includes('تم إرسال عرض الرحلة')));
  assert.ok(captain.writes.some((value) => value.includes('راكب')));
  assert.ok(admin.writes.some((value) => value.includes('DR-7')));
  assert.ok(captain.writes.every((value) => !value.includes('962790000000')));
  rider.emit('close'); captain.emit('close'); admin.emit('close');
});

test('direct ride events are emitted after durable state events without wallet mutation', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,role TEXT,active INTEGER DEFAULT 1,is_bot INTEGER DEFAULT 0,account_status TEXT DEFAULT 'active');");
  ensureDirectRideSchema(db);
  const emitted = [];
  const service = createDirectRideService({ db, emitEvent: (event) => emitted.push(event), audit: () => {} });
  const result = service.createRequest({ customerName: 'راكب', phone: '962790000000', origin: 'Origin', destination: 'Destination', originLat: 31.95, originLng: 35.91, destinationLat: 31.96, destinationLng: 35.92, distanceKm: 2, durationMin: 5, idempotencyKey: 'notify-test-1' });
  assert.equal(result.ok, true);
  assert.equal(emitted[0].eventType, 'priced');
  assert.equal(emitted[0].ride.status, 'priced');
  assert.equal(emitted[0].ride.liveDispatchEnabled, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM direct_ride_events').get().count, 1);
});
