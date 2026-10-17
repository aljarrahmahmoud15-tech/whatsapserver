const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("server.js", "utf8");

assert.match(
  source,
  /let created = await withTimeout\(client\.createGroup\(groupName\), WHATSAPP_GROUP_CREATE_TIMEOUT_MS, null\);/,
  "group creation must start with the isolated empty-group attempt",
);
assert.match(
  source,
  /typeof created === "string"[\s\S]{0,320}client\.createGroup\(groupName, participantIds\)/,
  "group creation must retry with the requested participants when the empty-group API is rejected",
);
assert.match(
  source,
  /const participantIds = phones\.map\(\(phone\) => `\$\{phone\}@c\.us`\);/,
  "fallback participants must be derived only from the requested normalized phone list",
);

console.log("group creation fallback guardrails verified");
