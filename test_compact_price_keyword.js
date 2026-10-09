const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('./server.js', 'utf8');
const start = source.indexOf('function parseOrder(text) {');
assert.notEqual(start, -1, 'parseOrder must exist');
let depth = 0;
let end = -1;
let inString = null;
let escaped = false;
for (let i = source.indexOf('{', start); i < source.length; i += 1) {
  const ch = source[i];
  if (inString) {
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === inString) inString = null;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') {
    inString = ch;
    continue;
  }
  if (ch === '{') depth += 1;
  if (ch === '}') {
    depth -= 1;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
assert.notEqual(end, -1, 'parseOrder body must be complete');
const parseOrder = vm.runInNewContext(`(${source.slice(start, end)})`);

assert.equal(parseOrder('السعر5\nراكب شب من مجمع بيت راس لا الزرقاء').price, 5);
assert.equal(parseOrder('السعر 5\nراكب من إربد إلى خلدا').price, 5);
assert.equal(parseOrder('السعر: 5\nراكب من إربد إلى خلدا').price, 5);
assert.equal(parseOrder('السعر 5 إلى 10\nراكب من إربد إلى خلدا').priceMin, 5);
assert.equal(parseOrder('رسالة عادية بلا سعر').isOrder, false);
console.log('compact price keyword regression passed');
