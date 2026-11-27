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

test('both captain login pages direct reset users to their private WhatsApp notice without showing a fixed PIN', () => {
  for (const page of [captainPage, ridePage]) {
    const context = loginPinContext(page);
    assert.match(context, /id="captain-pin-private-note"/);
    assert.match(context, /استخدم الرمز الذي وصلك برسالة WhatsApp خاصة/);
    assert.doesNotMatch(context, /0{5}/);
  }
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

test('captain group-verification and membership-lock UI wiring remains in place', () => {
  assert.match(captainPage, /id="group-verification-code"/);
  assert.match(ridePage, /id="verify-code"/);
  assert.match(rideScript, /captain_official_group_membership_required/);
  assert.match(rideScript, /lockAccess/);
});
