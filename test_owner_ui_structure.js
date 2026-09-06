const fs = require("fs");
const vm = require("vm");
const assert = require("assert/strict");

const html = fs.readFileSync("public/index.html", "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

assert.ok(scripts.length >= 2, "expected the main and operations scripts");
scripts.forEach((source, index) => {
  new vm.Script(source, { filename: `public/index.html#script-${index + 1}` });
});

const drawerIndex = html.indexOf('<div id="ops-drawer">');
const heroIndex = html.indexOf('<section class="hero">');
assert.ok(drawerIndex > 0 && drawerIndex < heroIndex, "operations drawer must appear near the top, before the overview hero");
assert.match(html, /id="username"[^>]*value="admin"/, "owner username must match production login");
assert.doesNotMatch(html, /showToast\('القسم جاهز للربط ببياناته التشغيلية\.'\)/, "navigation must not report a placeholder response");

console.log("owner UI structure verification passed");
