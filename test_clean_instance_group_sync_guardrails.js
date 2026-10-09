const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('./server.js', 'utf8');

const welcomeStart = server.indexOf('async function sendConfiguredGroupCaptainWelcome');
const welcomeEnd = server.indexOf('\nfunction activateHumanCaptainAccount', welcomeStart);
assert.ok(welcomeStart >= 0 && welcomeEnd > welcomeStart, 'configured-group welcome helper exists');
assert.match(server.slice(welcomeStart, welcomeEnd), /if \(CLEAN_INSTANCE\) return/, 'Clean never sends automatic group-join welcome cards');

const syncStart = server.indexOf('function scheduleConfiguredGroupCaptainSync');
const syncEnd = server.indexOf('\nasync function resolveGroupChat', syncStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart, 'automatic group sync scheduler exists');
assert.match(server.slice(syncStart, syncEnd), /if \(CLEAN_INSTANCE\) return/, 'Clean never auto-registers group members on group activity');

const normalizationStart = server.indexOf('async function normalizeAllCaptains');
const normalizationEnd = server.indexOf('\nfunction ', normalizationStart + 10);
assert.ok(normalizationStart >= 0 && normalizationEnd > normalizationStart, 'captain normalization helper exists');
assert.match(server.slice(normalizationStart, normalizationEnd), /const groupMembers = CLEAN_INSTANCE\s*\?/, 'Clean normalization skips live group-member import');

const groupJoinStart = server.indexOf('instance.on("group_join"');
const groupJoinEnd = server.indexOf('instance.on("message_create"', groupJoinStart);
assert.ok(groupJoinStart >= 0 && groupJoinEnd > groupJoinStart, 'group-join event handler exists');
const groupJoin = server.slice(groupJoinStart, groupJoinEnd);
assert.ok(groupJoin.indexOf('if (CLEAN_INSTANCE)') >= 0, 'Clean group-join handler is guarded');
assert.ok(groupJoin.indexOf('if (CLEAN_INSTANCE)') < groupJoin.indexOf('sendConfiguredGroupCaptainWelcome'), 'guard precedes any welcome send');

assert.match(server, /normalization\.status !== "already_completed" \|\| CLEAN_INSTANCE/, 'Clean startup skips the second automatic group sync');
console.log('Clean group-sync isolation and no-automatic-welcome guardrails verified');
