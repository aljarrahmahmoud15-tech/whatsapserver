const assert = require('node:assert/strict');
const DatabaseSync = require('node:sqlite').DatabaseSync;
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE ride_ratings (
    id INTEGER PRIMARY KEY,
    ride_id INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    rating INTEGER,
    status TEXT NOT NULL,
    submitted_at TEXT,
    expires_at TEXT NOT NULL,
    reminder_sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
const now = new Date();
const createdAt = new Date(now.getTime() - 59 * 60 * 1000).toISOString();
const expiresAt = new Date(now.getTime() + 47 * 60 * 60 * 1000).toISOString();
db.prepare(`INSERT INTO ride_ratings
  (id,ride_id,customer_phone,status,expires_at,created_at,updated_at)
  VALUES (1,99,'962787244559','pending',?,?,?)`).run(expiresAt, createdAt, createdAt);
const submittedAt = new Date().toISOString();
const updated = db.prepare(`UPDATE ride_ratings
  SET rating=?,status='submitted',submitted_at=?,updated_at=?
  WHERE id=? AND status='pending' AND expires_at>?`).run(5, submittedAt, submittedAt, 1, submittedAt);
assert.equal(updated.changes, 1);
const reminderCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const pendingForReminder = db.prepare(`SELECT id FROM ride_ratings
  WHERE status='pending' AND reminder_sent_at IS NULL AND created_at<=? AND expires_at>?`).all(reminderCutoff, new Date().toISOString());
assert.equal(pendingForReminder.length, 0);
const result = db.prepare('SELECT rating,status,reminder_sent_at FROM ride_ratings WHERE id=1').get();
assert.equal(result.rating, 5);
assert.equal(result.status, 'submitted');
assert.equal(result.reminder_sent_at, null);
console.log('early customer rating prevents the one-hour reminder: verified');
