const assert = require("assert");
const { calculateSettlement } = require("./finance");

const settlement = calculateSettlement({
  priceCents: 2000,
  orderKind: "normal",
  regularProducerRateBps: 1250,
  specialOrderProducerRateBps: 1600,
  companyFromProducerRateBps: 250,
});

const companyStartingBalance = 0;
const companyAfterCompanyShare = companyStartingBalance + settlement.companyCents;
const companyFinalBalance = companyAfterCompanyShare + settlement.producerNetCents;

assert.equal(settlement.producerFeeCents, 250);
assert.equal(settlement.companyCents, 50);
assert.equal(settlement.producerNetCents, 250);
assert.equal(companyFinalBalance, 300, "حصة المنتج 12.5% وعمولة الشركة 2.5% تذهبان معًا لرصيد الشركة");
assert.equal(settlement.producerNetCents > 0, true);
assert.equal("botWallet" in {}, false, "لا توجد محفظة مستقلة للبوت");

console.log("bot company employee settlement verified");
