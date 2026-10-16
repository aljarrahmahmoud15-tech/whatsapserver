const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("./server.js", "utf8");
const start = source.indexOf("function notifyPendingBookingApproval");
const end = source.indexOf("function findPendingAcceptanceByMessage", start);
const flow = source.slice(start, end);

assert.match(flow, /const pendingBookingOwnerApprovalCardEnabled = notificationEnabled\("pendingBookingApproval"\)/);
assert.match(flow, /pending_booking_owner_approval_card_disabled/);
assert.match(flow, /return;/);
assert.match(flow, /notifyOperations\(/);
assert.match(flow, /title: "حجز جديد بانتظار اعتماد المالك"/);

console.log("pending owner-approval branded card is disabled while candidate flow remains intact");
