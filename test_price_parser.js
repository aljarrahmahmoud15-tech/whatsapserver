const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('server.js', 'utf8');
const start = source.indexOf('function parseOrder');
const end = source.indexOf('\nfunction createOrderRecord', start);
assert.ok(start >= 0 && end > start, 'parseOrder function must exist');
const parseOrder = vm.runInNewContext(`(${source.slice(start, end)})`);

const cases = [
  ['راكب من عمّان إلى الزرقاء السعر خمس دنانير', 5, 'normal'],
  ['أوردر 5', 5, 'order'],
  ['من عمّان إلى الزرقاء سعر ٥ دنانير راكب', 5, 'normal'],
  ['أوردر السعر خمسة دنانير', 5, 'order'],
  ['السعر 3 إلى 5 راكب', 4, 'normal'],
];
for (const [text, expectedPrice, expectedKind] of cases) {
  const parsed = parseOrder(text);
  assert.equal(parsed.isOrder, true, text);
  assert.equal(parsed.price, expectedPrice, text);
  assert.equal(parsed.orderKind, expectedKind, text);
}

for (const text of ['راكب فقط', 'أوردر فقط', 'تم استلام الطلب']) {
  assert.equal(parseOrder(text).isOrder, false, text);
}

console.log('price parser guardrail tests passed');
