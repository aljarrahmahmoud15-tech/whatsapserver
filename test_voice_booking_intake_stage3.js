"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");
const parseStart = source.indexOf("function parseOrder(text)");
const parseEnd = source.indexOf("\nfunction createOrderRecord", parseStart);
const extractStart = source.indexOf("function extractVoiceBookingFields(transcript)");
const extractEnd = source.indexOf("\nfunction voiceTranscriptConfidence", extractStart);
assert.ok(parseStart >= 0 && parseEnd > parseStart, "parseOrder exists");
assert.ok(extractStart >= 0 && extractEnd > extractStart, "voice field extractor exists");

const context = {};
vm.runInNewContext(`${source.slice(parseStart, parseEnd)}\n${source.slice(extractStart, extractEnd)}`, context);
const complete = context.extractVoiceBookingFields("الأجرة 12 دينار\nمن عمان إلى الزرقاء\nركاب");
assert.equal(complete.status, "needs_review");
assert.equal(complete.fields.priceCents, 1200);
assert.equal(complete.fields.origin, "عمان");
assert.equal(complete.fields.destination, "الزرقاء");
assert.equal(complete.fields.requestKind, "ركاب");
assert.equal(complete.confidence, 1);

const incomplete = context.extractVoiceBookingFields("من عمان إلى الزرقاء");
assert.equal(incomplete.status, "needs_review");
assert.equal(incomplete.fields.priceCents, null);
assert.ok(incomplete.confidence < 1);

assert.match(source, /extracted_fields_json TEXT/);
assert.match(source, /extraction_confidence REAL/);
assert.match(source, /extraction_status TEXT/);
assert.match(source, /VOICE_BOOKING_EXTRACTION_SETTING_KEY/);
assert.match(source, /function voiceBookingFieldExtractionEffective\(\)/);
assert.match(source, /voice_booking_intake\.fields_extracted/);
assert.match(source, /body\.extractFields/);
assert.match(source, /draftBooking: false/);
assert.doesNotMatch(source.slice(extractStart, extractEnd), /createOrder|createOrderCandidate|settlePendingOrder|wallet_ledger/);
console.log("voice booking intake Stage 3 guardrails passed");
