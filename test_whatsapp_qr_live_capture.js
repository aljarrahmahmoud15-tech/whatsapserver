"use strict";

// Behavioural coverage for the live pairing-QR capture that replaces the endless /qr-main spinner.
// The helper must only ever screenshot pixels: it may not read the QR payload (data-ref value,
// canvas text or page body), it must cache briefly, deduplicate concurrent captures, refuse once
// the bot is connected, and degrade to a machine-readable reason instead of throwing.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("server.js", "utf8");

function slice(marker, endMarker) {
  const start = source.indexOf(marker);
  const end = source.indexOf(endMarker, start + marker.length);
  assert.ok(start >= 0 && end > start, `helper boundaries missing: ${marker}`);
  return source.slice(start, end);
}

const helper = slice("const LIVE_QR_CACHE_MS = 2000;", "function indexedDbErrorIsActive(pageState) {");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(4096, 7),
]);

const QR_BOX = { x: 120, y: 80, width: 228, height: 228, intrinsicWidth: 228, intrinsicHeight: 228, hidden: false, pairedScreen: true };

function loadCapture({ client, isReady = false, whatsappState = "starting" } = {}) {
  const logs = [];
  const context = vm.createContext({
    client,
    isReady,
    whatsappState,
    Buffer,
    console: { log: (...a) => logs.push(a.join(" ")) },
    now: () => new Date().toISOString(),
    withTimeout: async (promise, _ms, fallback) => {
      try {
        return await promise;
      } catch (error) {
        return fallback;
      }
    },
  });
  vm.runInContext(`${helper}
    globalThis.capture = captureLiveWhatsAppQrPng;
    globalThis.looksValid = liveQrPngLooksValid;
    globalThis.health = liveWhatsAppQrHealth;
    globalThis.reset = resetLiveWhatsAppQrCache;`, context);
  return { ...context, logs };
}

function fakePage({ evaluate, screenshot } = {}) {
  const calls = { evaluate: 0, screenshot: 0, clips: [] };
  return {
    calls,
    evaluate: typeof evaluate === "function"
      ? (...a) => { calls.evaluate++; return evaluate(...a); }
      : () => { calls.evaluate++; return Promise.resolve(QR_BOX); },
    screenshot: typeof screenshot === "function"
      ? (opts) => { calls.screenshot++; calls.clips.push(opts && opts.clip); return screenshot(opts); }
      : (opts) => { calls.screenshot++; calls.clips.push(opts && opts.clip); return Promise.resolve(PNG); },
  };
}

async function main() {
  // 1) The helper must never touch the QR payload, only geometry and pixel bytes.
  assert.ok(!/dataset\.ref|toDataURL|innerText|textContent|qrCodeData|window\.require/.test(helper),
    "live capture helper must not read QR payload material or WhatsApp modules");
  assert.match(helper, /document\.querySelector\("div\[data-ref\] canvas"\)/, "must locate the pairing canvas");
  assert.ok(!/fs\.|rmSync|unlinkSync|writeFileSync/.test(helper), "live capture must not write or delete anything");
  assert.match(helper, /pairing canvas captured \$\{width\}x\$\{height\} bytes=\$\{png\.length\} pairingScreen=\$\{Boolean\(box\.pairedScreen\)\} state=\$\{whatsappState\}/);
  assert.ok(!ctxFreeLogLeaks(helper), "must never log the captured image itself");
  function ctxFreeLogLeaks(text) {
    // Only the geometry log line may reference the image, and only as a byte count.
    const logs = text.split("\n").filter((line) => line.includes("console.log("));
    return logs.some((line) => /png\b(?!\.length)/.test(line.replace(/bytes=\$\{png\.length\}/, ""))
      || /liveQrPng/.test(line) || /\.toString\(/.test(line));
  }

  // 2) No pairing page yet -> reason, no throw, no screenshot attempt.
  {
    const ctx = loadCapture({ client: null });
    const out = await ctx.capture();
    assert.equal(out.ok, false);
    assert.equal(out.reason, "pairing_page_unavailable");
    assert.equal(out.png, null);
    assert.equal(ctx.health().available, false);
  }

  // 3) Canvas not drawn yet -> explicit reason, screenshot skipped.
  {
    const page = fakePage({ evaluate: () => Promise.resolve(null) });
    const ctx = loadCapture({ client: { pupPage: page } });
    const out = await ctx.capture();
    assert.equal(out.ok, false);
    assert.equal(out.reason, "qr_canvas_not_drawn_yet");
    assert.equal(page.calls.evaluate, 1);
    assert.equal(page.calls.screenshot, 0, "must not screenshot a canvas that is not there");
  }

  // 4) A placeholder canvas (too small / hidden) is rejected instead of shown as a QR.
  for (const box of [
    { ...QR_BOX, width: 24, height: 24 },
    { ...QR_BOX, hidden: true },
  ]) {
    const page = fakePage({ evaluate: () => Promise.resolve(box) });
    const ctx = loadCapture({ client: { pupPage: page } });
    const out = await ctx.capture();
    assert.equal(out.ok, false);
    assert.equal(out.reason, "qr_canvas_too_small");
    assert.equal(page.calls.screenshot, 0);
  }

  // 5) Happy path: valid PNG with a padded clip around the canvas, cached briefly, logged safely.
  {
    const page = fakePage();
    const ctx = loadCapture({ client: { pupPage: page }, whatsappState: "qr" });
    const out = await ctx.capture();
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.reason, "captured");
    assert.equal(Buffer.isBuffer(out.png), true);
    assert.equal(out.bytes, PNG.length);
    // The clip object is built inside the vm realm, so compare fields instead of deep equality.
    const clip = { ...page.calls.clips[0] };
    assert.deepEqual(clip, { x: 114, y: 74, width: 240, height: 240 }, "clip must pad the canvas box");
    assert.equal(page.calls.clips[0].type, undefined, "clip must not carry a screenshot type inside itself");
    const cached = await ctx.capture();
    assert.equal(cached.ok, true);
    assert.equal(cached.reason, "cached");
    assert.equal(page.calls.screenshot, 1, "repeated reads must reuse the 2s cache");
    const forced = await ctx.capture({ force: true });
    assert.equal(forced.reason, "captured");
    assert.equal(page.calls.screenshot, 2, "force must bypass the cache");
    assert.equal(ctx.logs.length, 2);
    assert.match(ctx.logs[0], /pairing canvas captured 228x228 bytes=4104 pairingScreen=true state=qr/);
    assert.ok(!ctx.logs.join(" ").includes(PNG.slice(8, 24).toString("base64")), "logs must not contain image data");
    const health = ctx.health();
    assert.equal(health.available, true);
    assert.equal(health.bytes, PNG.length);
    assert.equal(typeof health.capturedAt, "string");
    assert.equal(typeof looksValidIn(ctx), "function");
    assert.equal(ctx.looksValid(PNG), true);
    assert.equal(ctx.looksValid(Buffer.from("nope")), false);
    assert.equal(ctx.looksValid(null), false);
    assert.equal(ctx.looksValid("2@abc,def,ghi,jkl,5"), false, "a payload string is not an image");
  }

  // 6) A broken screenshot (non PNG) never becomes the cached image.
  {
    const page = fakePage({ screenshot: () => Promise.resolve(Buffer.from("not a png")) });
    const ctx = loadCapture({ client: { pupPage: page } });
    const out = await ctx.capture();
    assert.equal(out.ok, false);
    assert.equal(out.reason, "screenshot_failed");
    assert.equal(ctx.health().available, false);
    assert.equal(ctx.health().bytes, 0);
  }

  // 7) Rejecting page handles surface as reasons, not crashes.
  {
    const page = fakePage({ evaluate: () => Promise.reject(new Error("detached frame")) });
    const ctx = loadCapture({ client: { pupPage: page } });
    const out = await ctx.capture();
    assert.equal(out.ok, false);
    assert.equal(out.reason, "qr_canvas_not_drawn_yet");
  }
  {
    const page = fakePage({ screenshot: () => Promise.reject(new Error("timeout")) });
    const ctx = loadCapture({ client: { pupPage: page } });
    const out = await ctx.capture();
    assert.equal(out.ok, false);
    assert.equal(out.reason, "screenshot_failed");
  }

  // 8) Concurrent requests share one capture.
  {
    const page = fakePage();
    const ctx = loadCapture({ client: { pupPage: page } });
    const trio = await Promise.all([ctx.capture(), ctx.capture(), ctx.capture()]);
    assert.equal(trio.every((r) => r.ok === true), true);
    assert.equal(page.calls.screenshot, 1, "in-flight capture must be shared");
  }

  // 9) Once connected there is nothing to show; a reset drops the pairing image.
  {
    const page = fakePage();
    const ctx = loadCapture({ client: { pupPage: page }, isReady: true });
    const out = await ctx.capture();
    assert.equal(out.ok, false);
    assert.equal(out.reason, "already_connected");
    assert.equal(page.calls.evaluate, 0);
  }
  {
    const page = fakePage();
    const ctx = loadCapture({ client: { pupPage: page } });
    const ok = await ctx.capture();
    assert.equal(ok.ok, true);
    assert.equal(ctx.health().available, true);
    ctx.reset("authenticated");
    assert.equal(ctx.health().available, false);
    assert.equal(ctx.health().capturedAt, null);
    assert.equal(ctx.health().last.reason, "authenticated");
    assert.equal(ctx.health().bytes, 0, "a reset must drop the pairing image completely");
    const again = await ctx.capture();
    assert.equal(again.ok, true, "a fresh pairing cycle must be capturable again");
    assert.equal(ctx.health().bytes, PNG.length);
  }

  // 10) Wiring: guarded PNG route, no endless spinner, cache reset on reconnect, status field.
  assert.match(source, /app\.get\("\/api\/admin\/whatsapp\/qr-live\.png", requireQrAccess, async \(req, res\) => \{/);
  assert.match(source, /error: "live_pairing_qr_unavailable"/);
  assert.match(source, /res\.setHeader\("Content-Type", "image\/png"\);/);
  assert.doesNotMatch(source, /<h2>جاري تجهيز QR البوت الرئيسي/, "/qr-main must no longer spin forever");
  assert.match(source, /resetLiveWhatsAppQrCache\("restart"\)/);
  assert.match(source, /resetLiveWhatsAppQrCache\("authenticated"\)/);
  assert.match(source, /const qrLive = liveWhatsAppQrHealth\(\);/);
  assert.match(source, /src="\$\{liveSrc\}"/, "/qr-main must show the live pairing window");
  assert.equal((source.match(/app\.get\("\/api\/admin\/whatsapp\/qr-live\.png"/g) || []).length, 1,
    "exactly one live QR route, registered behind the QR access guard");
  assert.equal((source.match(/app\.get\("\/api\/admin\/whatsapp\/qr-live\.png", requireQrAccess/g) || []).length, 1,
    "the live QR route must be guarded by requireQrAccess");
}

function looksValidIn(ctx) {
  return ctx.looksValid;
}

main().then(() => {
  console.log("Live pairing QR: geometry-only capture, cached and deduplicated, guarded route, no payload exposure");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
