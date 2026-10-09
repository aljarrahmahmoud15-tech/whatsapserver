const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('./server.js', 'utf8');
const parseStart = source.indexOf('function parseOrder(');
const parseEnd = source.indexOf('function isCaptainAcceptance(', parseStart);
const recoveryStart = source.indexOf('function recoveryExpectedMatches(');
const recoveryEnd = source.indexOf('function recoveryEvidenceSummary(', recoveryStart);
assert.ok(parseStart >= 0 && parseEnd > parseStart, 'parser موجود');
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'مطابقة الاسترداد موجودة');

const context = {
  phoneWithCountry: (value) => String(value || ''),
  recoveryPhoneMatches: (actual, expected) => String(actual || '') === String(expected || ''),
};
vm.runInNewContext(`${source.slice(parseStart, parseEnd)}\n${source.slice(recoveryStart, recoveryEnd)}\nthis.parseOrder=parseOrder; this.recoveryExpectedMatches=recoveryExpectedMatches;`, context);

assert.equal(context.parseOrder('السعر 5').price, 5);
assert.equal(context.parseOrder('السعر 17.5').price, 17.5);
assert.equal(context.parseOrder('السعر 25 دينار\nالساعة 03:00').isOrder, true);

const evidence = {
  orderMessageId: 'source-1',
  acceptanceMessageId: 'acceptance-1',
  producerPhone: '962775241160',
  captainPhone: '962785772155',
  parsed: { price: 5, origin: 'المزار', destination: 'لخو' },
  rawText: 'السعر 5\nنشامى 2 من المزار لخو',
};
assert.equal(context.recoveryExpectedMatches(evidence, {
  sourceMessageId: 'source-1',
  acceptanceMessageId: 'acceptance-1',
  downloaderPhone: '962775241160',
  executorPhone: '962785772155',
  price: 5,
  tripTime: '23:59',
}), true, 'وقت الرحلة لا يرفض المطابقة');

console.log('price-only variable-value matching verified');
