const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const captainPage = fs.readFileSync('public/captain.html', 'utf8');
const ridePage = fs.readFileSync('public/ride-captain.html', 'utf8');
const rideScript = fs.readFileSync('public/ride-captain.js', 'utf8');

function loginPinContext(page) {
  const marker = 'id="pin"';
  const index = page.indexOf(marker);
  assert.notEqual(index, -1, 'login PIN input exists');
  return page.slice(Math.max(0, index - 220), Math.min(page.length, index + 760));
}

function loginPinInput(page) {
  const input = page.match(/<input\b[^>]*\bid="pin"[^>]*>/);
  assert.ok(input, 'login PIN input element exists');
  return input[0];
}

test('Captain login screens clearly direct PIN change/recovery to the owner', () => {
  const captainContext = loginPinContext(captainPage);
  const rideContext = loginPinContext(ridePage);
  assert.match(captainContext, /id="captain-pin-private-note"/);
  assert.match(captainContext, /تغيير رمز الدخول أو استعادته متاح للمالك فقط/);
  assert.match(rideContext, /id="captain-pin-private-note"/);
  assert.match(rideContext, /لا يمكنك تغيير رمز الدخول أو استعادته من هذه الصفحة/);
  for (const context of [captainContext, rideContext]) assert.doesNotMatch(context, /0{5}/);
});

test('both login forms accept exactly five numeric characters as a masked password', () => {
  for (const page of [captainPage, ridePage]) {
    const input = loginPinInput(page);
    assert.match(input, /\btype="password"/);
    assert.match(input, /\binputmode="numeric"/);
    assert.match(input, /\bmaxlength="5"/);
    assert.match(input, /\bpattern="\[0-9\]\{5\}"/);
  }
});

test('Captain account panel replaces self-service forms with a clear owner-only notice', () => {
  assert.match(captainPage, /aria-label="إدارة رمز الكابتن"/);
  assert.match(captainPage, /لا يمكنك تغيير الرمز أو استعادته ذاتيًا/);
  assert.doesNotMatch(captainPage, /captain-change-pin-form|pin-recovery|forgot-pin-btn/);
  assert.match(captainPage, /id="whatsapp-login-btn"/);
  assert.match(ridePage, /id="whatsapp-login-button"/);
});

test('captain group-verification and membership-lock UI wiring remains in place', () => {
  assert.match(captainPage, /id="group-verification-code"/);
  assert.match(ridePage, /id="verify-code"/);
  assert.match(rideScript, /captain_official_group_membership_required/);
  assert.match(rideScript, /lockAccess/);
});
