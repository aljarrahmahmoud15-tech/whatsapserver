"use strict";
// Owner request 2026-11-23: «عمولة الأوردر» gets its own owner-only window in V27 and V26.
// Root cause guarded here: the V27/V26 normal-rate form sent only the normal pair, and the PATCH
// route copied that pair onto «أوردر», so saving 13%+3% silently turned the order rate 17%+3%=20%
// into 13%+3%=16%. Each kind must now fall back to its own saved rate.
// Run in isolation: the PATCH handler and the policy readers are sliced out of server.js and run in
// a fresh vm context with an in-memory settings map. The server is never required and never booted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("server.js", "utf8");
const v27 = fs.readFileSync("public/admin-v27.html", "utf8");
const v26 = fs.readFileSync("public/admin-v26.html", "utf8");

function sliceBetween(text, startMarker, endMarker, label) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${label} slice exists`);
  return text.slice(start, end);
}
function constDeclaration(name) {
  const match = source.match(new RegExp(`^const ${name} = .+$`, "m"));
  assert.ok(match, `const ${name} is declared`);
  return match[0];
}

const routeSlice = sliceBetween(source, 'app.patch("/api/admin/settings/settlement", requireOwnerAdmin', 'app.post("/api/admin/change-password"', "settlement PATCH route");
const policySlice = sliceBetween(source, "function currentSettlementPolicy() {", "function runtimeSettlementPolicyDisplay() {", "policy readers");

function loadRoute(initialSettings) {
  const settings = new Map(Object.entries(initialSettings));
  const audits = [];
  const handlers = {};
  const context = {
    getSetting: (key, fallback = null) => (settings.has(key) ? settings.get(key) : fallback),
    setSetting: (key, value) => { settings.set(key, value); },
    audit: (...args) => { audits.push(args); },
    db: { transaction: (fn) => () => fn() },
    requireOwnerAdmin: () => {},
    notificationEnabled: () => false,
    CAPTAIN_DEBT_POLICY_ENABLED: false,
    CAPTAIN_MANUAL_WALLET_CHANGES_ENABLED: false,
    console: { error: () => {} },
    app: { patch: (route, _guard, handler) => { handlers[route] = handler; } },
  };
  vm.createContext(context);
  vm.runInContext([
    constDeclaration("COMPANY_RATE_BPS"),
    constDeclaration("PRODUCER_RATE_BPS"),
    constDeclaration("SPECIAL_ORDER_RATE_BPS"),
    constDeclaration("SPECIAL_ORDER_COMPANY_FROM_PRODUCER_RATE_BPS"),
    constDeclaration("COMPANY_FROM_PRODUCER_RATE_BPS"),
    constDeclaration("OWNER_CUSTOM_SETTLEMENT_POLICY_VERSION"),
    policySlice,
    routeSlice,
    "this.currentSettlementPolicy = currentSettlementPolicy;",
  ].join("\n"), context);
  const handler = handlers["/api/admin/settings/settlement"];
  assert.equal(typeof handler, "function", "PATCH handler registered");
  const call = (body) => {
    const res = { statusCode: 200, body: null, headers: {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.setHeader = (key, value) => { res.headers[key] = value; };
    handler({ body }, res);
    return res;
  };
  return { call, settings, audits, policy: () => context.currentSettlementPolicy() };
}

const approvedSplit = {
  producer_rate_bps: 1300,
  company_rate_bps: 300,
  order_producer_rate_bps: 1700,
  order_company_rate_bps: 300,
  special_order_rate_bps: 1700,
  special_order_company_from_producer_rate_bps: 300,
};

test("saving only the normal pair (old V27/V26 page) keeps «أوردر» at 17%+3%=20%", () => {
  const route = loadRoute(approvedSplit);
  const res = route.call({ producerRatePercent: 13, companyRatePercent: 3 });
  assert.equal(res.statusCode, 200);
  const policy = route.policy();
  assert.equal(policy.producerRateBps, 1300);
  assert.equal(policy.companyRateBps, 300);
  assert.equal(policy.specialOrderProducerRateBps, 1700, "order downloader rate is not overwritten by the normal rate");
  assert.equal(policy.specialOrderCompanyRateBps, 300);
  assert.equal(policy.specialOrderTotalRateBps, 2000, "order total stays 20%");
  assert.match(res.body.message, /وأوردر 17% للمنزّل \+ 3% للشركة = خصم 20%/);
});

test("the order window can change «أوردر» alone without touching the normal pair", () => {
  const route = loadRoute(approvedSplit);
  const res = route.call({ orderProducerRatePercent: 18, orderCompanyRatePercent: 2 });
  assert.equal(res.statusCode, 200);
  const policy = route.policy();
  assert.equal(policy.producerRateBps, 1300, "normal downloader rate unchanged");
  assert.equal(policy.companyRateBps, 300, "normal company rate unchanged");
  assert.equal(policy.specialOrderProducerRateBps, 1800);
  assert.equal(policy.specialOrderCompanyRateBps, 200);
  assert.equal(route.settings.get("special_order_rate_bps"), 1800, "legacy order key mirrors the order rate, not the normal rate");
  assert.equal(route.settings.get("settlement_policy_version"), "owner_custom_after_v3");
});

test("all four fields are stored exactly as sent", () => {
  const route = loadRoute(approvedSplit);
  const res = route.call({ producerRatePercent: 12.5, companyRatePercent: 3.5, orderProducerRatePercent: 16, orderCompanyRatePercent: 4 });
  assert.equal(res.statusCode, 200);
  const policy = route.policy();
  assert.deepEqual([policy.producerRateBps, policy.companyRateBps, policy.specialOrderProducerRateBps, policy.specialOrderCompanyRateBps], [1250, 350, 1600, 400]);
});

test("a single order field keeps the other order field at its saved value", () => {
  const route = loadRoute(approvedSplit);
  const res = route.call({ orderProducerRatePercent: 16 });
  assert.equal(res.statusCode, 200);
  const policy = route.policy();
  assert.equal(policy.specialOrderProducerRateBps, 1600);
  assert.equal(policy.specialOrderCompanyRateBps, 300, "order company share falls back to its own saved 3%");
  assert.equal(policy.producerRateBps, 1300);
});

test("fractional saved rates remain valid fallbacks", () => {
  const route = loadRoute({ ...approvedSplit, company_rate_bps: 329 });
  const res = route.call({ orderProducerRatePercent: 17, orderCompanyRatePercent: 3 });
  assert.equal(res.statusCode, 200);
  assert.equal(route.policy().companyRateBps, 329, "3.29% saved normal company rate survives an order-only save");
});

test("an empty body and invalid order sums are refused without writing anything", () => {
  const route = loadRoute(approvedSplit);
  const empty = route.call({});
  assert.equal(empty.statusCode, 400);
  const overflow = route.call({ orderProducerRatePercent: 90, orderCompanyRatePercent: 20 });
  assert.equal(overflow.statusCode, 400);
  const negative = route.call({ orderProducerRatePercent: -1 });
  assert.equal(negative.statusCode, 400);
  const tooPrecise = route.call({ orderProducerRatePercent: 17.123 });
  assert.equal(tooPrecise.statusCode, 400);
  assert.equal(route.audits.length, 0, "no policy change was audited");
  assert.equal(route.settings.get("settlement_policy_version"), undefined, "no setting was written");
  const policy = route.policy();
  assert.deepEqual([policy.producerRateBps, policy.companyRateBps, policy.specialOrderProducerRateBps, policy.specialOrderCompanyRateBps], [1300, 300, 1700, 300]);
});

test("the route no longer mirrors the normal pair onto «أوردر»", () => {
  assert.ok(!routeSlice.includes("optionalPercent(req.body?.orderProducerRatePercent, producerPercent)"), "order downloader rate never falls back to the normal rate");
  assert.ok(!routeSlice.includes("optionalPercent(req.body?.orderCompanyRatePercent, companyPercent)"), "order company rate never falls back to the normal rate");
  assert.ok(routeSlice.includes("optionalPercent(req.body?.orderProducerRatePercent, before.specialOrderProducerRateBps / 100)"));
  assert.ok(routeSlice.includes("optionalPercent(req.body?.orderCompanyRatePercent, before.specialOrderCompanyRateBps / 100)"));
  assert.ok(routeSlice.indexOf("const before = currentSettlementPolicy();") < routeSlice.indexOf("const producerPercent"), "saved policy is read before any fallback");
  assert.match(source, /app\.patch\("\/api\/admin\/settings\/settlement", requireOwnerAdmin, \(req, res\) => \{/, "route stays owner-only");
});

for (const [label, page] of [["V27", v27], ["V26", v26]]) {
  test(`${label} owner settings expose a separate «عمولة الأوردر» window`, () => {
    assert.ok(page.includes('<form id="ownerOrderCommissionForm" class="modal-form"><h3>عمولة الأوردر · تحكم المالك</h3>'));
    assert.ok(page.includes('<input id="ownerOrderProducerRate" type="number" min="0" max="100" step="0.01" value="${esc(policy.specialOrderProducerRatePercent??\'\')}" required>'));
    assert.ok(page.includes('<input id="ownerOrderCompanyRate" type="number" min="0" max="100" step="0.01" value="${esc(policy.specialOrderCompanyRatePercent??\'\')}" required>'));
    assert.ok(page.includes('<button class="primary" type="submit">حفظ عمولة الأوردر</button>'));
    assert.ok(page.includes('<h3>عمولة الطلب العادي / الراكب</h3>'));
    assert.ok(page.includes('الأوردر: ${esc(policy.specialOrderProducerRatePercent??\'—\')}% + ${esc(policy.specialOrderCompanyRatePercent??\'—\')}% = ${esc(policy.specialOrderTotalRatePercent??\'—\')}%.'), "current order split is shown");
    // The window lives inside openOwnerSettings, which only the owner settings action opens.
    const ownerSettings = page.slice(page.indexOf("async function openOwnerSettings()"));
    assert.ok(ownerSettings.indexOf("ownerOrderCommissionForm") > 0, "order window is part of the owner settings view");
  });

  test(`${label} both save buttons send all four rates so neither kind can overwrite the other`, () => {
    assert.ok(!page.includes("body:JSON.stringify({producerRatePercent:producer,companyRatePercent:company})"), "the two-field body that caused the overwrite is gone");
    const fullBody = "body:JSON.stringify({producerRatePercent:producer,companyRatePercent:company,orderProducerRatePercent:orderProducer,orderCompanyRatePercent:orderCompany})";
    assert.equal(page.split(fullBody).length - 1, 2, "normal and order windows each send the four rates");
    assert.ok(page.includes("const orderProducer=Number(current.specialOrderProducerRatePercent),orderCompany=Number(current.specialOrderCompanyRatePercent);"), "normal window reads the saved order rates fresh before saving");
    assert.ok(page.includes("const producer=Number(current.producerRatePercent),company=Number(current.companyRatePercent);"), "order window reads the saved normal rates fresh before saving");
    assert.ok(page.includes("throw new Error('تعذر قراءة عمولة الأوردر الحالية؛ لم يتم الحفظ')"), "normal window refuses to save when the order rates cannot be read");
    assert.ok(page.includes("throw new Error('تعذر قراءة نسب الطلب العادي الحالية؛ لم يتم الحفظ')"), "order window refuses to save when the normal rates cannot be read");
  });

  test(`${label} order preview shows the 15 JOD example as 2.55 + 0.45 = 3.00`, () => {
    const helpers = sliceBetween(page, "const ownerRatePairValid=", "['ownerOrderProducerRate','ownerOrderCompanyRate'].forEach", `${label} preview helpers`);
    const elements = {
      ownerOrderProducerRate: { value: "17" },
      ownerOrderCompanyRate: { value: "3" },
      ownerOrderCommissionPreview: { className: "", textContent: "" },
    };
    const context = { $: (id) => elements[id] };
    vm.createContext(context);
    vm.runInContext(`${helpers}\nthis.ownerOrderPreview = ownerOrderPreview; this.ownerRatePairValid = ownerRatePairValid;`, context);
    context.ownerOrderPreview();
    assert.equal(elements.ownerOrderCommissionPreview.textContent, "إجمالي خصم الأوردر من محفظة المنفّذ: 20% · مثال أوردر 15 دينار: 2.55 للمنزّل + 0.45 للشركة = 3.00 خصم");
    elements.ownerOrderProducerRate.value = "90";
    elements.ownerOrderCompanyRate.value = "20";
    context.ownerOrderPreview();
    assert.equal(elements.ownerOrderCommissionPreview.className, "notice warning", "an over-100% split is flagged");
    assert.equal(context.ownerRatePairValid(13, 3), true);
    assert.equal(context.ownerRatePairValid(-1, 3), false);
    assert.equal(context.ownerRatePairValid(Number.NaN, 3), false);
  });
}
