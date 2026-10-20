const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { ensureDirectRideSchema, createDirectRideService } = require('./direct-ride-service');

test('smart ride contract is idempotent and keeps live dispatch paused by default', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,role TEXT,active INTEGER DEFAULT 1,is_bot INTEGER DEFAULT 0,account_status TEXT DEFAULT 'active');");
  ensureDirectRideSchema(db);
  const service = createDirectRideService({ db, dispatchEnabled: false, audit: () => {} });
  const input = {
    customerName: 'عميل اختبار',
    phone: '962790000000',
    origin: 'موقع الإقلاع',
    destination: 'الوجهة',
    originLat: 31.9500,
    originLng: 35.9100,
    destinationLat: 31.9700,
    destinationLng: 35.9300,
    distanceKm: 3,
    durationMin: 7,
    waitingMin: 10,
    tripTime: '23:00',
    idempotencyKey: 'smart-contract-1',
  };
  const created = service.createRequest(input);
  assert.equal(created.ok, true);
  assert.equal(created.duplicate, false);
  assert.equal(created.row.status, 'priced');
  assert.ok(created.row.quoted_price_cents >= 100);
  assert.ok(created.token);

  const duplicate = service.createRequest(input);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.row.id, created.row.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM direct_ride_requests').get().count, 1);

  const confirmed = service.confirmRider(created.row.id, created.token, 'smart-contract-confirm');
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.row.status, 'rider_confirmed');

  const paused = service.dispatch(created.row.id, { actorRole: 'rider', idempotencyKey: 'smart-contract-dispatch' });
  assert.equal(paused.ok, true);
  assert.equal(paused.paused, true);
  assert.equal(paused.row.status, 'dispatch_pending');

  const cancelled = service.cancel(created.row.id, 'rider', null, 'اختبار محدود', 'smart-contract-cancel');
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.row.status, 'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM direct_ride_events WHERE event_type = \'cancelled\'').get().count, 1);
});
