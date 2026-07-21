// Integration test for Signal-parity C4 — hide record authorship — over the C3b
// unified opaque store. Once a household is e2eeActive, an HDK record written to
// /records must store NO plaintext `userId` (the author is sealed inside `enc`);
// the server attributes it only to the plaintext `householdId` it stamps, and
// reads scope by householdId. Pins: (1) an active HDK create nulls the author +
// stamps householdId; (2) household-scoped sync still returns author-nulled
// records to every member; (3) cross-household isolation holds; (4) a pre-active
// (dual-write window) create keeps the author; (5) a client can't spoof
// householdId. Mirrors the calendarKeys / tripKeys / invitations suites.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startDb, stopDb, request, b64u, fakeEnc, registerUser, enrollKeys, joinHousehold,
} = require('./harness');

const Household = require('../models/Household');
const Record = require('../models/Record');

before(startDb);
after(stopDb);

// Flip a household live (post-drop) so the author-hiding write rule applies.
async function activate(householdId) {
  await Household.updateOne({ _id: householdId }, { $set: { e2eeActive: true } });
}

// C3b: the unified opaque store is the single content path. A create carries only
// ciphertext (the type + content + author are inside enc).
const create = (auth, body = {}) =>
  request().post('/api/records').set('Authorization', auth).send({ enc: fakeEnc(), keyVersion: 1, ...body });
const sync = (auth) => request().get('/api/records/sync').set('Authorization', auth);

test('C4: an e2eeActive HDK create hides the author and attributes to householdId', async () => {
  const owner = await registerUser({ firstName: 'Ada' });
  const member = await registerUser({ firstName: 'Ben' });
  await enrollKeys(owner.auth);
  await enrollKeys(member.auth);
  await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  const hh = await request().get('/api/household').set('Authorization', owner.auth);
  const householdId = hh.body._id;
  await joinHousehold({ joiner: member, approver: owner, keyVersion: 1 });
  await activate(householdId);

  // A sealed record created by the member: the store keeps no plaintext author.
  const created = await create(member.auth);
  assert.equal(created.status, 201);

  const row = await Record.findById(created.body._id).lean();
  assert.equal(row.userId, undefined, 'the member-granular author is not stored in plaintext');
  assert.equal(String(row.householdId), String(householdId), 'the record is attributed to the household');
  assert.ok(row.enc?.ct, 'the ciphertext (carrying the author) is intact');

  // Both members read it back through the household-scoped sync, even though it
  // carries no plaintext userId at all.
  for (const who of [owner, member]) {
    const list = await sync(who.auth);
    assert.equal(list.status, 200);
    assert.ok(list.body.records.find((t) => String(t._id) === String(row._id)), 'author-nulled record is visible to the household');
  }
});

test('C4: cross-household isolation — another household can never read the record', async () => {
  const a = await registerUser({ firstName: 'Cara' });
  await enrollKeys(a.auth);
  await request().post('/api/household/key')
    .set('Authorization', a.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  const ahh = await request().get('/api/household').set('Authorization', a.auth);
  await activate(ahh.body._id);
  const mine = await create(a.auth);
  const rowId = mine.body._id;

  // A totally separate household never sees it in its sync feed.
  const b = await registerUser({ firstName: 'Dan' });
  await enrollKeys(b.auth);
  const bList = await sync(b.auth);
  assert.equal(bList.status, 200);
  assert.equal(bList.body.records.find((t) => String(t._id) === String(rowId)), undefined, 'no cross-household read');
});

test('C4: a pre-active (dual-write) create still keeps the author plaintext', async () => {
  const owner = await registerUser({ firstName: 'Eve' });
  await enrollKeys(owner.auth);
  await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  // NOT activated: the dual-write window still keeps the plaintext author for
  // readiness/pre-enrollment reads.
  const created = await create(owner.auth);
  const row = await Record.findById(created.body._id).lean();
  assert.equal(String(row.userId), String(owner.user._id), 'author stays plaintext before the drop');
});

test('C4: a client cannot spoof householdId to escape its own scope', async () => {
  const a = await registerUser({ firstName: 'Fay' });
  await enrollKeys(a.auth);
  await request().post('/api/household/key')
    .set('Authorization', a.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  const ahh = await request().get('/api/household').set('Authorization', a.auth);
  await activate(ahh.body._id);

  // Craft a create carrying a bogus foreign householdId in the body.
  const bogus = '66aabbccddeeff0011223344';
  const created = await create(a.auth, { householdId: bogus });
  assert.equal(created.status, 201);
  const row = await Record.findById(created.body._id).lean();
  assert.equal(String(row.householdId), String(ahh.body._id), 'householdId is forced to the requester household');
  assert.notEqual(String(row.householdId), bogus);
});
