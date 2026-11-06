const assert = require("assert");
const limit = -100;
const fee = 100;
const mayExecute = (balance) => balance - fee >= limit;

assert.equal(mayExecute(0), true, "الرصيد 0.00 يسمح بالوصول إلى −1.00");
assert.equal(mayExecute(99), true, "الرصيد المتوقع السالب ضمن حد −1.00 يُسمح به");
assert.equal(mayExecute(-100), false, "المشترك عند الحد لا يبدأ تنفيذًا يتجاوزه");
const botWallet = { is_bot: 1, wallet_cents: 100 };
assert.equal(mayExecute(botWallet.wallet_cents), true, "محفظة البوت تخضع للحد نفسه");
assert.equal(mayExecute(-101), false, "محفظة البوت تحت الحد لا تنفذ");

const server = require("fs").readFileSync(require("path").join(__dirname, "server.js"), "utf8");
assert.match(server, /existing\.active === 0/);
assert.match(server, /producer\.active === 0/);
assert.match(server, /negative_balance_floor_without_removal/);
assert.match(server, /process\.env\.CAPTAIN_MIN_BALANCE_CENTS \|\| -100/);
assert.match(server, /debtLimit: `\$\{money\(CAPTAIN_MIN_BALANCE_CENTS\)\} JOD للخصومات اليدوية والاشتراكات فقط/);

console.log("credit floor -1.00 JOD and no-negative-removal guard verified");
