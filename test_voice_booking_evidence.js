"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const source = fs.readFileSync("server.js", "utf8");

assert.match(source, /app\.get\("\/api\/admin\/group\/voice-booking-evidence", requireAdmin, adminReadLimiter/);
assert.match(source, /mutation: "none"/);
assert.match(source, /readOnly: true/);
assert.match(source, /voice_booking_intakes vi/);
assert.match(source, /transcript_confidence/);
assert.match(source, /extracted_fields_json/);
assert.match(source, /storedReactionEvidence\(acceptanceMessageId, "👍"\)/);
assert.match(source, /reaction\?\.senderPhone/);
assert.match(source, /value\.phoneNumber/);
assert.doesNotMatch(source.slice(source.indexOf('app.get("/api/admin/group/voice-booking-evidence"'), source.indexOf('app.get("/api/admin/unconfirmed-bookings"')), /INSERT INTO orders|UPDATE orders|wallet_ledger|settlePendingOrder/);
console.log("voice booking evidence endpoint guardrails passed");
