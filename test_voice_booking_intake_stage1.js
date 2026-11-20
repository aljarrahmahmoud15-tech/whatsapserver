"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");

assert.match(source, /const VOICE_BOOKING_INTAKE_SETTING_KEY = "official_group_voice_booking_intake_enabled"/);
assert.match(source, /function voiceBookingIntakeEnabled\(\) \{\s*return readBooleanSetting\(VOICE_BOOKING_INTAKE_SETTING_KEY, false\);/);
assert.match(source, /CREATE TABLE IF NOT EXISTS voice_booking_intakes/);
assert.match(source, /message_id TEXT NOT NULL UNIQUE/);
assert.match(source, /status TEXT NOT NULL CHECK\(status IN \('received','downloaded','failed','skipped'\)\)/);

const intakeStart = source.indexOf("async function handleIncomingVoiceBookingIntake(message, { groupId, senderPhone, senderName = \"\" })");
const intakeEnd = source.indexOf("\nfunction generalMessageDeletionEnabled", intakeStart);
assert.ok(intakeStart >= 0 && intakeEnd > intakeStart, "voice intake handler exists");
const intake = source.slice(intakeStart, intakeEnd);
assert.match(intake, /groupId !== configuredRuntimeGroupId\(\)/);
assert.match(intake, /message\?\.fromMe/);
assert.match(intake, /isGroupSetupOwner\(normalizedPhone\)/);
assert.match(intake, /isOfficialGroupAdminPhone\(normalizedPhone\)/);
assert.match(intake, /senderIdentityHint = normalizedPhone \|\| serializedWhatsappUserId/);
assert.match(intake, /INSERT OR IGNORE INTO voice_booking_intakes\(message_id,group_id,sender_phone/);
assert.match(intake, /resolveMessageSenderPhone\(message\)/);
assert.match(intake, /identityAttempts = 3/);
assert.match(intake, /setTimeout\(resolve, 750\)/);
assert.match(intake, /UPDATE voice_booking_intakes SET attempts=/);
assert.match(intake, /sender_identity_unresolved/);
assert.match(intake, /UPDATE voice_booking_intakes SET sender_phone=/);
assert.match(intake, /INSERT OR IGNORE INTO voice_booking_intakes/);
assert.match(intake, /message\.downloadMedia\(\)/);
assert.match(intake, /fs\.mkdtempSync\(path\.join\("\/tmp", "voice-booking-intake-"\)\)/);
assert.match(intake, /crypto\.createHash\("sha256"\)/);
assert.match(intake, /fs\.rmSync\(tempPath, \{ force: true \}\)/);
assert.match(intake, /fs\.rmSync\(tempDir, \{ recursive: false, force: true \}\)/);
assert.match(intake, /financialMutation: false/);
assert.match(intake, /orderMutation: false/);
assert.doesNotMatch(intake, /INSERT INTO orders|settlePendingOrder|wallet_ledger|draftBooking\s*[:=]\s*true/);

const messageHandler = source.indexOf('if (typeof isIncomingVoiceMessage === "function" && isIncomingVoiceMessage(msg))');
const deletionCall = source.indexOf("handleIncomingVoiceMessagePolicy(msg", messageHandler);
const intakeCall = source.indexOf("handleIncomingVoiceBookingIntake(msg", messageHandler);
assert.ok(intakeCall >= messageHandler && intakeCall < deletionCall, "intake precedes existing voice deletion policy");

assert.match(source, /app\.get\("\/api\/admin\/settings\/voice-booking-intake", requireOwnerAdmin/);
assert.match(source, /app\.patch\("\/api\/admin\/settings\/voice-booking-intake", requireOwnerAdmin/);
assert.match(source, /capture_and_temporary_download_only/);
assert.match(source, /draftBooking: false/);
assert.match(source, /async function recoverHistoricalVoiceBookingIntakes\(groupId\)/);
assert.match(source, /fetchGroupHistory\(groupId, 200/);
assert.match(source, /24 \* 60 \* 60 \* 1000/);
assert.match(source, /getWhatsAppMessageByIdVariants\(messageId, 5000\)/);
assert.match(source, /const intakeMessage = liveMessage \|\| message/);
assert.match(source, /liveLookupHits/);
assert.match(source, /await handleIncomingVoiceBookingIntake\(intakeMessage/);
const backgroundRecoveryStart = source.indexOf("function startBackgroundOrderRecovery(groupId)");
const backgroundRecoveryEnd = source.indexOf("async function recoverPendingAcceptanceMessages", backgroundRecoveryStart);
const backgroundRecovery = source.slice(backgroundRecoveryStart, backgroundRecoveryEnd);
assert.ok(backgroundRecovery.indexOf("await recoverHistoricalVoiceBookingIntakes(groupId)") < backgroundRecovery.indexOf("await recoverHistoricalOrderCandidates(groupId)"), "voice recovery runs before broad order recovery");
assert.doesNotMatch(source.slice(source.indexOf("async function recoverHistoricalVoiceBookingIntakes"), source.indexOf("async function recoverPendingAcceptanceMessages")), /settlePendingOrder|INSERT INTO orders|wallet_ledger/);

console.log("voice booking intake Stage 1 guardrails passed");
