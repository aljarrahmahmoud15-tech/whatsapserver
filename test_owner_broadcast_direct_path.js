const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("./server.js"), "utf8");
const start = source.indexOf('if (command === "group.broadcast")');
const end = source.indexOf('\n  }\n\n  const reason = `owner-command.${command}`;', start);
assert.ok(start >= 0, "group.broadcast route block must exist");
assert.ok(end > start, "group.broadcast route block boundary must exist");
const block = source.slice(start, end);

assert.match(block, /groupId !== officialGroupId/);
assert.match(block, /isServer2OutboundTargetAllowed\(groupId\)/);
assert.match(block, /client\.sendMessage\(groupId, message\)/);
assert.doesNotMatch(block, /resolveGroupChat\(groupId\)/, "broadcast must not depend on a hydrated chat wrapper");
assert.doesNotMatch(block, /chat\.sendMessage\(message\)/, "broadcast must use the direct client send path");

console.log("owner broadcast direct-path guardrail passed");
