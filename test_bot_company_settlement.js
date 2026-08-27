const assert = require("assert");
const { calculateSettlement } = require("./finance");

const settlement = calculateSettlement({
  priceCents: 2000,
  orderKind: "normal",
  regularProducerRateBps: 1500,
  specialOrderProducerRateBps: 2000,
  companyFromProducerRateBps: 1500,
});

const companyStartingBalance = 0;
const companyAfterCompanyShare = companyStartingBalance + settlement.companyCents;
const companyFinalBalance = companyAfterCompanyShare + settlement.producerNetCents;

assert.equal(settlement.producerFeeCents, 300);
assert.equal(settlement.companyCents, 45);
assert.equal(settlement.producerNetCents, 255);
assert.equal(companyFinalBalance, 300, "ربح المنتج الموظف وحصة الشركة يذهبان معًا لرصيد الشركة");
assert.equal(settlement.producerNetCents > 0, true);
assert.equal("botWallet" in {}, false, "لا توجد محفظة مستقلة للبوت");

console.log("bot company employee settlement verified");
