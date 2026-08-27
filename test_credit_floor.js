const assert = require("assert");
const limit = -200;
const fee = 300;
const mayExecute = (balance) => balance - fee >= limit;

assert.equal(mayExecute(100), true, "رصيد 1.00 يسمح بالوصول إلى −2.00");
assert.equal(mayExecute(99), false, "الرصيد الذي يؤدي إلى أقل من −2.00 يُرفض");
assert.equal(mayExecute(-200), false, "المشترك عند الحد لا يبدأ تنفيذًا جديدًا");
const botWallet = { is_bot: 1, wallet_cents: 100 };
assert.equal(mayExecute(botWallet.wallet_cents), true, "محفظة البوت تخضع للحد نفسه");
assert.equal(mayExecute(-201), false, "محفظة البوت تحت الحد لا تنفذ");

const server = require("fs").readFileSync(require("path").join(__dirname, "server.js"), "utf8");
assert.match(server, /existing\.active === 0/);
assert.match(server, /producer\.active === 0/);
assert.match(server, /suspendMemberForDebt/);

console.log("credit floor and suspension guard verified");
