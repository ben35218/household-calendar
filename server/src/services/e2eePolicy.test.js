const { test } = require('node:test');
const assert = require('node:assert/strict');
const { e2eeRequired, plaintextCreateBlocked } = require('./e2eePolicy');

test('e2eeRequired: mandatory for every household (no exemptions)', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(e2eeRequired({}), true, 'every household is required');
    assert.equal(e2eeRequired({ e2eeExempt: true }), true, 'the old exempt flag no longer opts out');
    assert.equal(e2eeRequired(null), false, 'no household => nothing to enforce');

    process.env.NODE_ENV = 'test';
    assert.equal(e2eeRequired({}), false, 'test env always bypasses');

    process.env.E2EE_ENFORCE_IN_TEST = '1';
    assert.equal(e2eeRequired({}), true, 'the test opt-in re-enables enforcement');
    delete process.env.E2EE_ENFORCE_IN_TEST;
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('plaintextCreateBlocked: only blocks enc-less writes under the mandate', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const enc = { alg: 'xchacha20poly1305-ietf', nonce: 'n', ct: 'c' };
    assert.equal(plaintextCreateBlocked({}, undefined), true, 'mandate + no enc => blocked');
    assert.equal(plaintextCreateBlocked({}, enc), false, 'mandate + enc => allowed');
    assert.equal(plaintextCreateBlocked(null, undefined), false, 'no household => never blocked');
  } finally {
    process.env.NODE_ENV = prev;
  }
});
