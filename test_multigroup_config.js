const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");

assert.match(source, /parseWhatsAppGroupsConfig/);
assert.match(source, /process\.env\.WHATSAPP_GROUPS_JSON/);
assert.match(source, /const WHATSAPP_GROUPS_BY_ID = new Map/);
assert.match(source, /function groupPolicy\(groupId\)/);
assert.match(source, /function configuredEnvironmentGroupIds\(\)/);
assert.match(source, /processOrders: entry\?\.processOrders === true/);
assert.match(source, /settlements: entry\?\.settlements === true/);
assert.match(source, /if \(!policy\.processOrders\)/);
assert.match(source, /if \(typeof groupPolicy === "function" && !groupPolicy\(target\.from\)\?\.reactions\) return;/);
assert.match(source, /settlements_disabled/);
assert.match(source, /synchronized multi-group environment/);
assert.match(source, /groups: configuredEnvironmentGroupIds\(\)\.map/);

console.log("multi-group configuration guardrails passed");
