const test = require('node:test');
const assert = require('node:assert');
const { computeReadiness, dropUnsetFor, DROP_FIELDS } = require('./dropReadiness');

const member = (id, email, pub) => ({ _id: id, email, identityPublicKey: pub });
const env = (userId, keyVersion) => ({ userId, keyVersion });

test('ready when every member is enrolled and holds a current-version envelope', () => {
  const r = computeReadiness({
    members: [member('a', 'a@x', 'PKa'), member('b', 'b@x', 'PKb')],
    envelopes: [env('a', 1), env('b', 1)],
    currentKeyVersion: 1,
  });
  assert.equal(r.ready, true);
  assert.equal(r.reasons.length, 0);
});

test('not ready when a member has not enrolled', () => {
  const r = computeReadiness({
    members: [member('a', 'a@x', 'PKa'), member('b', 'b@x', null)],
    envelopes: [env('a', 1)],
    currentKeyVersion: 1,
  });
  assert.equal(r.ready, false);
  assert.match(r.reasons.join(' '), /b@x has not enrolled/);
});

test('not ready when a member lacks an envelope for the current version', () => {
  const r = computeReadiness({
    members: [member('a', 'a@x', 'PKa'), member('b', 'b@x', 'PKb')],
    envelopes: [env('a', 1), env('b', 1)],
    currentKeyVersion: 2, // rotated; b only has a v1 envelope
  });
  assert.equal(r.ready, false);
  assert.match(r.reasons.join(' '), /no key envelope for v2/);
});

test('not ready when the HDK has never been minted', () => {
  const r = computeReadiness({ members: [member('a', 'a@x', 'PKa')], envelopes: [], currentKeyVersion: 0 });
  assert.equal(r.ready, false);
  assert.match(r.reasons.join(' '), /no HDK yet/);
});

test('dropUnsetFor builds a $unset spec from the content field list', () => {
  const unset = dropUnsetFor('Person');
  assert.deepEqual(Object.keys(unset).sort(), [...DROP_FIELDS.Person].sort());
  assert.equal(unset.name, '');
  assert.equal(dropUnsetFor('NopeCollection'), null);
});
