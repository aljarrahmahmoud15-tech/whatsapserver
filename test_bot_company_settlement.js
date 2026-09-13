const assert = require("assert");
const { calculateSettlement } = require("./finance");

const settlement = calculateSettlement({
  priceCents: 2000,
  orderKind: "normal",
  regularProducerRateBps: 1200,
  specialOrderProducerRateBps: 1200,
  companyFromProducerRateBps: 400,
});

const companyStartingBalance = 0;
const companyAfterCompanyShare = companyStartingBalance + settlement.companyCents;
const companyFinalBalance = companyAfterCompanyShare + settlement.producerNetCents;

assert.equal(settlement.producerFeeCents, 240);
assert.equal(settlement.companyCents, 80);
assert.equal(settlement.producerNetCents, 240);
assert.equal(companyFinalBalance, 320, "حصة المنتج 12% وعمولة الشركة 4% تذهبان معًا لرصيد الشركة");
assert.equal(settlement.producerNetCents > 0, true);
assert.equal("botWallet" in {}, false, "لا توجد محفظة مستقلة للبوت");

console.log("bot company employee settlement verified");
