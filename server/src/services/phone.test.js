const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('./phone');

test('normalizePhone: strips formatting to digits, preserving a leading +', () => {
  assert.equal(normalizePhone('(416) 555-0199'), '4165550199');
  assert.equal(normalizePhone('416-555-0199'), '4165550199');
  assert.equal(normalizePhone('+1 416 555 0199'), '+14165550199');
});

test('normalizePhone: two different formats of the same number agree', () => {
  assert.equal(normalizePhone('(416) 555-0199'), normalizePhone('416.555.0199'));
});

test('normalizePhone: rejects too-short / too-long / empty input', () => {
  assert.equal(normalizePhone('12345'), null);       // < 7 digits
  assert.equal(normalizePhone('1234567890123456'), null); // > 15 digits
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('   '), null);
});
