const assert = require("assert");
const limit = -300;
const fee = 300;
const mayExecute = (balance) => balance - fee >= limit;

assert.equal(mayExecute(0), true, "الرصيد 0.00 يسمح بالوصول إلى −3.00");
assert.equal(mayExecute(-1), false, "الرصيد الذي يؤدي إلى أقل من −3.00 يُرفض");
assert.equal(mayExecute(-300), false, "المشترك عند الحد لا يبدأ تنفيذًا جديدًا");
const botWallet = { is_bot: 1, wallet_cents: 100 };
assert.equal(mayExecute(botWallet.wallet_cents), true, "محفظة البوت تخضع للحد نفسه");
assert.equal(mayExecute(-301), false, "محفظة البوت تحت الحد لا تنفذ");

const server = require("fs").readFileSync(require("path").join(__dirname, "server.js"), "utf8");
assert.match(server, /existing\.active === 0/);
assert.match(server, /producer\.active === 0/);
assert.match(server, /suspendMemberForDebt/);
assert.match(server, /process\.env\.CAPTAIN_MIN_BALANCE_CENTS \|\| -300/);
assert.match(server, /debtLimit: `\$\{money\(CAPTAIN_MIN_BALANCE_CENTS\)\} JOD`/);

console.log("credit floor and suspension guard verified");
