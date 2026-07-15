const { test } = require('node:test');
const assert = require('node:assert/strict');
const { e2eeRequired, plaintextCreateBlocked } = require('./e2eePolicy');

test('e2eeRequired: mandatory policy with exemptions', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(e2eeRequired({ e2eeExempt: false }), true, 'required by default');
    assert.equal(e2eeRequired({}), true, 'missing flag => required');
    assert.equal(e2eeRequired({ e2eeExempt: true }), false, 'exempt households opt out');
    assert.equal(e2eeRequired(null), false, 'no household => nothing to enforce');

    process.env.NODE_ENV = 'test';
    assert.equal(e2eeRequired({ e2eeExempt: false }), false, 'test env always bypasses');

    process.env.E2EE_ENFORCE_IN_TEST = '1';
    assert.equal(e2eeRequired({ e2eeExempt: false }), true, 'the test opt-in re-enables enforcement');
    assert.equal(e2eeRequired({ e2eeExempt: true }), false, 'exemption still wins under the opt-in');
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
    assert.equal(plaintextCreateBlocked({ e2eeExempt: false }, undefined), true, 'mandate + no enc => blocked');
    assert.equal(plaintextCreateBlocked({ e2eeExempt: false }, enc), false, 'mandate + enc => allowed');
    assert.equal(plaintextCreateBlocked({ e2eeExempt: true }, undefined), false, 'exempt => never blocked');
    assert.equal(plaintextCreateBlocked(null, undefined), false, 'no household => never blocked');
  } finally {
    process.env.NODE_ENV = prev;
  }
});
