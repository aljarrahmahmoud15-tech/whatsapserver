"use strict";
// Stage 1 guard: whatsapp-web.js 1.34.8 already ships the __x_id media collision fix,
// so the postinstall patch MUST become a clean no-op instead of breaking the Docker build.
// The same script must still patch the older layout and must still fail loudly on a layout
// it does not recognise: a silent skip there would ship the original media bug.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = __dirname;
const scriptSource = fs.readFileSync(path.join(repoRoot, "scripts", "patch-whatsapp-web-media.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));

function fixture(utilsBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-patch-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "whatsapp-web.js", "src", "util", "Injected"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "patch-whatsapp-web-media.js"), scriptSource);
  const target = path.join(root, "node_modules", "whatsapp-web.js", "src", "util", "Injected", "Utils.js");
  fs.writeFileSync(target, utilsBody);
  return { root, target };
}
function run(root) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(root, "scripts", "patch-whatsapp-web-media.js")], { encoding: "utf8" });
    return { code: 0, stdout: stdout.trim() };
  } catch (error) {
    return { code: error.status, stdout: String(error.stdout || "").trim(), stderr: String(error.stderr || "") };
  }
}

// 1) The dependency is pinned to one immutable upstream commit in both manifests.
const expectedCommit = "38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2";
const expectedSource = `https://codeload.github.com/wwebjs/whatsapp-web.js/tar.gz/${expectedCommit}`;
assert.equal(packageJson.dependencies["whatsapp-web.js"], expectedSource, "package.json pins the reviewed socket-fix commit");
assert.equal(lock.packages["node_modules/whatsapp-web.js"].version, "1.34.8", "package-lock.json resolves the same version");
assert.equal(lock.packages[""].dependencies["whatsapp-web.js"], expectedSource, "lock root records the same immutable source");
assert.equal(lock.packages["node_modules/whatsapp-web.js"].resolved, expectedSource, "lock resolves the same immutable source");
assert.ok(lock.packages["node_modules/whatsapp-web.js"].integrity, "lock carries an integrity hash for the pinned archive");

// 2) The 1.34.8 layout (upstream already contains the fix) must be a clean no-op.
const upstreamNeedle = "            ...extraOptions,\n        };\n\n        // Bot's won't reply if canonicalUrl is set (linking)\n";
const v1348 = `    window.WWebJS.getMessageModel = (message) => {\n        const extra = {\n            ...message,${upstreamNeedle}};\n        delete message.__x_id;\n        return extra;\n    };\n`;
const fixed = fixture(v1348.replace("        delete message.__x_id;\n", ""));
fs.writeFileSync(fixed.target, v1348);
const before = fs.readFileSync(fixed.target, "utf8");
const noop = run(fixed.root);
assert.equal(noop.code, 0, "postinstall exits 0 on the 1.34.8 layout");
assert.match(noop.stdout, /already applied/, "postinstall reports the fix as already applied upstream");
assert.equal(fs.readFileSync(fixed.target, "utf8"), before, "the installed Utils.js is untouched by the no-op");

// 3) The pre-fix 1.34.7-style layout must still get patched.
const legacy = fixture(`    window.WWebJS.getMessageModel = (message) => {\n        const extra = {\n            ...message,${upstreamNeedle}};\n    };\n`);
const patched = run(legacy.root);
assert.equal(patched.code, 0, "postinstall exits 0 on the legacy layout");
assert.match(patched.stdout, /patched whatsapp-web.js media id collision/, "legacy layout still gets the collision fix");
assert.match(fs.readFileSync(legacy.target, "utf8"), /delete message\.__x_id;/, "legacy file now carries the fix");

// 4) An unrecognised layout must fail loudly rather than silently shipping the bug.
const unknown = fixture("/* a future WhatsApp Web bundle layout we do not know */\n");
const failed = run(unknown.root);
assert.notEqual(failed.code, 0, "an unknown layout fails the install instead of passing quietly");
assert.match(failed.stderr + failed.stdout, /Unsupported whatsapp-web\.js Utils\.js layout/, "failure names the unsupported layout");

for (const dir of [fixed.root, legacy.root, unknown.root]) fs.rmSync(dir, { recursive: true, force: true });
console.log("whatsapp-web.js 1.34.8 media patch upgrade guard ok");
