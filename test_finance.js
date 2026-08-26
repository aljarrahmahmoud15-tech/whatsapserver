const assert = require("assert");
const { calculateSettlement } = require("./finance");

const regular = calculateSettlement({ priceCents: 2000, orderKind: "normal" });
assert.deepStrictEqual(regular, {
  orderKind: "normal",
  grossCents: 2000,
  producerRateBps: 1500,
  producerFeeCents: 300,
  companyCents: 45,
  producerNetCents: 255,
  captainFeeCents: 300,
  captainGrossCents: 2000,
});

const special = calculateSettlement({ priceCents: 2000, orderKind: "order" });
assert.deepStrictEqual(special, {
  orderKind: "order",
  grossCents: 2000,
  producerRateBps: 2000,
  producerFeeCents: 400,
  companyCents: 60,
  producerNetCents: 340,
  captainFeeCents: 400,
  captainGrossCents: 2000,
});

console.log(JSON.stringify({ regular, special }));
