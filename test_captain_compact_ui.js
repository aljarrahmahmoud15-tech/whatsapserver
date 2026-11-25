'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'public', 'captain.html'), 'utf8');
const metrics = html.match(/<section class="metrics"[^>]*>([\s\S]*?)<\/section>/)?.[1] || '';

test('captain portal always applies the compact design and has no design gallery controls', () => {
  assert.match(html, /function applyCaptainDesign\(\) \{ document\.body\.dataset\.captainDesign = 'compact'; \}/);
  assert.match(html, /applyCaptainDesign\(\);/);
  assert.doesNotMatch(html, /captain-design-gallery|captainDesignTitles|activateCaptainDesign|\/api\/captain\/ui-design/);
});

test('captain financial summary shows balance and debited commission but no production share', () => {
  assert.match(metrics, /id="balance"/);
  assert.match(metrics, /id="fees"/);
  assert.match(metrics, /عمولة الطلبات المخصومة من رصيدك/);
  assert.doesNotMatch(metrics, /net-earnings|posted-share|صافي الأرباح|حصة الإنتاج/);
  assert.match(html, /setText\('fees', data\.earnings\?\.executedDebit \|\| data\.earnings\?\.fees \|\| '0\.00'\);/);
  assert.doesNotMatch(html, /setText\('net-earnings'|postedShare|earnings\?\.gross/);
});

test('recharge methods are visible by default and the other captain sections remain present', () => {
  assert.match(html, /#app:not\(\.account-open\) \.topup-window\{display:block\}/);
  assert.match(html, /class="topup-request topup-window panel captain-account-item"/);
  assert.match(html, /class="payment-box" aria-label="طرق التحويل"/);
  assert.match(html, /<strong>Orange Money<\/strong>/);
  assert.match(html, /<strong>بنك الاتحاد<\/strong>/);
  assert.match(html, /id="captain-active-orders-panel"/);
  assert.match(html, /id="captain-new-orders"/);
  assert.match(html, /id="ledger"/);
  assert.match(html, /id="withdrawal-request-btn"/);
  assert.match(html, /id="captain-support-panel"/);
  assert.match(html, /id="captain-account-toggle"/);
});
