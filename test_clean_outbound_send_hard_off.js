"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { guardOutboundMethod } = require("./whatsapp-outbound-guard");

const serverSource = fs.readFileSync("./server.js", "utf8");

function disabledError(operation) {
  const error = new Error("outbound disabled in fake test");
  error.code = "CLEAN_OUTBOUND_SENDS_DISABLED";
  error.operation = operation;
  return error;
}

test("Clean transport guard blocks text, media, replies, and reactions before transport", async () => {
  const transportCalls = [];
  const client = {
    async sendMessage(...args) { transportCalls.push(["message", ...args]); return "sent"; },
    async sendReaction(...args) { transportCalls.push(["reaction", ...args]); return "reacted"; },
  };
  const shouldBlock = (operation) => disabledError(operation);
  guardOutboundMethod(client, "sendMessage", shouldBlock);
  guardOutboundMethod(client, "sendReaction", shouldBlock);

  const chat = { sendMessage: (...args) => client.sendMessage(...args) };
  const message = {
    reply: (...args) => client.sendMessage(...args),
    react: (...args) => client.sendReaction(...args),
  };

  await assert.rejects(chat.sendMessage("text"), { code: "CLEAN_OUTBOUND_SENDS_DISABLED" });
  await assert.rejects(chat.sendMessage(Buffer.from("media")), { code: "CLEAN_OUTBOUND_SENDS_DISABLED" });
  await assert.rejects(message.reply("reply"), { code: "CLEAN_OUTBOUND_SENDS_DISABLED" });
  await assert.rejects(message.react("👍"), { code: "CLEAN_OUTBOUND_SENDS_DISABLED" });
  assert.deepEqual(transportCalls, [], "no fake transport call may occur while blocked");
});

test("guard preserves the original behavior when a different service policy permits sends", async () => {
  const calls = [];
  const client = {
    async sendMessage(target, body) { calls.push([target, body]); return { id: "fake-message" }; },
  };
  guardOutboundMethod(client, "sendMessage", () => null);
  const result = await client.sendMessage("test-target", "test-body");
  assert.deepEqual(result, { id: "fake-message" });
  assert.deepEqual(calls, [["test-target", "test-body"]]);
});

test("Clean branch is wired fail-closed to both WhatsApp transport methods", () => {
  assert.match(serverSource, /const CLEAN_OUTBOUND_SENDS_ENABLED\s*=\s*false;/);
  const start = serverSource.indexOf("function installWhatsAppStorageSendGuard(instance)");
  const end = serverSource.indexOf("\nfunction stopWhatsAppStorageMonitor", start);
  assert.ok(start >= 0 && end > start, "central client guard exists");
  const guard = serverSource.slice(start, end);
  assert.match(guard, /guardOutboundMethod\(instance, "sendMessage"/);
  assert.match(guard, /guardOutboundMethod\(instance, "sendReaction"/);
  assert.match(guard, /CLEAN_OUTBOUND_SENDS_DISABLED/);
  assert.match(serverSource, /outboundMessaging:\s*\{[\s\S]{0,180}blocked:\s*CLEAN_OUTBOUND_SENDS_DISABLED/);
});

test("invite issuance and group-member sync reject before any database mutation", () => {
  for (const [route, operation] of [
    ['app.post("/api/admin/captain-invites",', "captain_invite_issue"],
    ['app.post("/api/admin/captain-invites/send",', "captain_invite_send"],
    ['app.post("/api/admin/captain-invites/import",', "captain_invite_bulk_issue"],
    ['app.get("/api/admin/group/send-member-invites",', "group_member_invites"],
  ]) {
    const start = serverSource.indexOf(route);
    assert.ok(start >= 0, `${route} route exists`);
    const routeBody = serverSource.slice(start, start + 700);
    assert.ok(routeBody.indexOf(`rejectCleanOutboundOperation(res, "${operation}")`) >= 0, `${operation} is blocked at route entry`);
  }

  const syncStart = serverSource.indexOf('app.post("/api/admin/group/sync-captains",');
  assert.ok(syncStart >= 0, "manual group sync route exists");
  const syncRoute = serverSource.slice(syncStart, syncStart + 550);
  assert.match(syncRoute, /CLEAN_INSTANCE[\s\S]{0,180}CLEAN_GROUP_SYNC_DISABLED/);
  assert.ok(syncRoute.indexOf("CLEAN_GROUP_SYNC_DISABLED") < syncRoute.indexOf('getSetting("group_id"'), "Clean rejects group sync before reading or mutating participants");
});

test("Clean group operations require the service's exact environment group", () => {
  const configureStart = serverSource.indexOf("function configureGroupId(");
  const configureEnd = serverSource.indexOf("\nfunction isConfiguredGroup", configureStart);
  const runtimeStart = serverSource.indexOf("function configuredRuntimeGroupId()");
  const runtimeEnd = serverSource.indexOf("\nfunction isServer2OutboundTargetAllowed", runtimeStart);
  assert.ok(configureStart >= 0 && configureEnd > configureStart);
  assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart);
  assert.match(serverSource.slice(configureStart, configureEnd), /!WHATSAPP_GROUP_ID \|\| normalizedGroupId !== WHATSAPP_GROUP_ID/);
  assert.match(serverSource.slice(runtimeStart, runtimeEnd), /if \(!WHATSAPP_GROUP_ID\) return ""/);

  const joinStart = serverSource.indexOf('app.post("/api/admin/group/join-invite",');
  assert.ok(joinStart >= 0);
  const joinRoute = serverSource.slice(joinStart, joinStart + 1500);
  assert.match(joinRoute, /if \(!WHATSAPP_GROUP_ID\)/);
  assert.match(joinRoute, /groupId !== WHATSAPP_GROUP_ID/);
});

test("Clean group panels cannot inspect members or invite metadata outside the configured group", () => {
  const route = (needle) => {
    const start = serverSource.indexOf(needle);
    assert.ok(start >= 0, `${needle} route exists`);
    const end = serverSource.indexOf("\n});", start);
    assert.ok(end > start, `${needle} route has a bounded body`);
    return serverSource.slice(start, end);
  };
  const membersRoute = route('app.get("/api/admin/group/members",');
  assert.match(membersRoute, /const officialGroupId = configuredRuntimeGroupId\(\)/);
  assert.match(membersRoute, /groupId !== officialGroupId \|\| !isConfiguredGroup\(groupId\)/);

  const inviteRoute = route('app.post("/api/admin/group/invite-info",');
  assert.match(inviteRoute, /if \(!officialGroupId\)/);
  assert.match(inviteRoute, /inviteGroupId !== officialGroupId/);

  const diagnosticRoute = route('app.get("/api/admin/group/diagnostic",');
  assert.match(diagnosticRoute, /configuredId !== officialGroupId \|\| !isConfiguredGroup\(configuredId\)/);
  assert.match(diagnosticRoute, /inviteGroupId !== officialGroupId/);
});
