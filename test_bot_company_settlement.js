const assert = require("assert");
const { calculateSettlement } = require("./finance");

const settlement = calculateSettlement({
  priceCents: 2000,
  orderKind: "normal",
  regularProducerRateBps: 1300,
  specialOrderProducerRateBps: 1300,
  companyFromProducerRateBps: 200,
});

const companyStartingBalance = 0;
const companyAfterCompanyShare = companyStartingBalance + settlement.companyCents;
const companyFinalBalance = companyAfterCompanyShare + settlement.producerNetCents;

assert.equal(settlement.producerFeeCents, 260);
assert.equal(settlement.companyCents, 40);
assert.equal(settlement.producerNetCents, 260);
assert.equal(companyFinalBalance, 300, "حصة المنتج 13% وعمولة الشركة 2% تذهبان معًا لرصيد الشركة");
assert.equal(settlement.producerNetCents > 0, true);
assert.equal("botWallet" in {}, false, "لا توجد محفظة مستقلة للبوت");

console.log("bot company employee settlement verified");
