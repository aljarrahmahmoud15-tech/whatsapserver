const assert = require("assert");
const { calculateSettlement } = require("./finance");

const regular = calculateSettlement({ priceCents: 2000, orderKind: "normal" });
assert.deepStrictEqual(regular, {
  orderKind: "normal",
  grossCents: 2000,
  producerRateBps: 1200,
  producerFeeCents: 240,
  companyCents: 80,
  producerNetCents: 240,
  captainFeeCents: 80,
  captainGrossCents: 2000,
});

const special = calculateSettlement({ priceCents: 2000, orderKind: "order" });
assert.deepStrictEqual(special, {
  orderKind: "order",
  grossCents: 2000,
  producerRateBps: 1200,
  producerFeeCents: 240,
  companyCents: 80,
  producerNetCents: 240,
  captainFeeCents: 80,
  captainGrossCents: 2000,
});

console.log(JSON.stringify({ regular, special }));
