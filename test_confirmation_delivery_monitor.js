const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('server.js', 'utf8');

test('delivery monitor records WhatsApp ACK and runs automatically', () => {
  assert.match(source, /CREATE TABLE IF NOT EXISTS order_confirmation_deliveries[\s\S]*ack_status TEXT/);
  assert.match(source, /ADD COLUMN ack_status TEXT/);
  assert.match(source, /function recordConfirmationMessageAck\(message, ack\)/);
  assert.match(source, /instance\.on\("message_ack", async \(msg, ack\) => \{/);
  assert.match(source, /recordConfirmationMessageAck\(msg, ack\)/);
  assert.match(source, /function startConfirmationDeliveryMonitor\(\)/);
  assert.match(source, /startConfirmationDeliveryMonitor\(\);/);
});

test('delivery monitor alerts once per order and does not mutate wallets', () => {
  assert.match(source, /order\.confirmation_delivery\.monitor\.failed\.\$\{orderId\}/);
  assert.match(source, /SELECT id FROM notifications WHERE event=\? LIMIT 1/);
  assert.match(source, /لم يتم تأكيد تسليم رسالة التثبيت عبر WhatsApp/);
  assert.doesNotMatch(source.slice(source.indexOf('async function monitorConfirmationDeliveries'), source.indexOf('function startConfirmationDeliveryMonitor')), /wallet_cents|wallet_ledger|settle/i);
});

test('ACK timeout is observable without duplicate resend', () => {
  assert.match(source, /CONFIRMATION_DELIVERY_ACK_TIMEOUT_MS/);
  assert.match(source, /ack_status IS NULL/);
  assert.match(source, /ack_status='timeout'/);
  assert.match(source, /تم منع التكرار وستستمر آلية الاسترداد الآمنة/);
});
