// Integration test for the §9 plaintext drop — the full journey a real household
// takes: enroll → mint → join → seal stragglers via the API → readiness (incl.
// the min-app-version gate) → dry run → COMMIT → and then the API exercised with
// e2eeActive = true. This is the path that was previously never executed anywhere.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startDb, stopDb, request, b64u, fakeEnc, registerUser, enrollKeys, joinHousehold,
} = require('./harness');

const Household = require('../models/Household');
const Person = require('../models/Person');
const CalendarEvent = require('../models/CalendarEvent');
const Trip = require('../models/Trip');
const TripItem = require('../models/TripItem');
const AuditLog = require('../models/AuditLog');
const { dropPlaintext } = require('../scripts/dropPlaintext');

before(startDb);
after(stopDb);

test('the whole drop journey: seal → readiness → dry run → commit → post-drop API', async (t) => {
  // ── Setup: a household of two with real onboarding ─────────────────────────
  const owner = await registerUser({ firstName: 'Ada' });
  const member = await registerUser({ firstName: 'Ben' });
  await enrollKeys(owner.auth);
  await enrollKeys(member.auth);
  await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  const hh = await request().get('/api/household').set('Authorization', owner.auth);
  const householdId = hh.body._id;
  await joinHousehold({ joiner: member, approver: owner, keyVersion: 1 });

  // Content: a sealed event (dual-write), a sealed private trip + booking, and a
  // SHARED trip + booking that must stay plaintext for outside collaborators.
  const event = await CalendarEvent.create({
    userId: owner.user._id, calendarType: 'appointments', title: 'Dentist',
    startDate: new Date('2026-08-10'), enc: fakeEnc(), keyVersion: 1,
  });
  const privateTrip = await Trip.create({
    userId: owner.user._id, name: 'Anniversary', destination: 'Quebec City',
    start: new Date('2026-10-01'), end: new Date('2026-10-04'), enc: fakeEnc(), keyVersion: 1,
  });
  const sharedTrip = await Trip.create({
    userId: owner.user._id, name: 'Cousins camping', destination: 'Algonquin',
    start: new Date('2026-07-20'), end: new Date('2026-07-22'),
    sharedWithOutside: [{ email: 'cousin@example.com' }],
  });
  const sharedItem = await TripItem.create({
    userId: owner.user._id, householdId: owner.user.householdId, tripId: sharedTrip._id,
    type: 'activity', title: 'Canoe rental', start: new Date('2026-07-20'),
  });

  // ── 1) Stragglers block the drop (the two seeded self-Persons lack enc) ────
  let result = await dropPlaintext(householdId);
  assert.equal(result.status, 'stragglers');

  const stragglers = await request().get('/api/household/e2ee/stragglers').set('Authorization', owner.auth);
  assert.equal(stragglers.status, 200);
  const personRows = stragglers.body.collections.find((c) => c.collection === 'Person');
  assert.ok(personRows, 'the seeded self-Persons should surface as stragglers');
  assert.equal(personRows.records.length, 2);
  // The shared trip is legitimately plaintext — it must NOT be offered for sealing.
  const tripRows = stragglers.body.collections.find((c) => c.collection === 'Trip');
  assert.equal(tripRows, undefined);

  // Seal each straggler through the real content-blind endpoint.
  for (const row of personRows.records) {
    const seal = await request().post('/api/household/e2ee/seal')
      .set('Authorization', owner.auth)
      .send({ collection: 'Person', _id: row._id, enc: fakeEnc(), keyVersion: 1 });
    assert.equal(seal.status, 200);
  }
  // Same for the shared trip's booking? No — exempt. But the private trip's
  // booking doesn't exist and the event is already sealed, so we're clean now.
  const after1 = await request().get('/api/household/e2ee/stragglers').set('Authorization', owner.auth);
  assert.equal(after1.body.total, 0);

  // ── 2) Min-app-version gate ────────────────────────────────────────────────
  process.env.E2EE_MIN_APP_VERSION = '1.2.0';
  t.after(() => { delete process.env.E2EE_MIN_APP_VERSION; });
  let readiness = await request().get('/api/household/e2ee/readiness').set('Authorization', owner.auth);
  assert.equal(readiness.body.ready, false, 'unreported client versions must fail the gate');

  for (const u of [owner, member]) {
    const rep = await request().post('/api/household/e2ee/client-version')
      .set('Authorization', u.auth).send({ version: '1.2.3', platform: 'ios' });
    assert.equal(rep.status, 200);
  }
  readiness = await request().get('/api/household/e2ee/readiness').set('Authorization', owner.auth);
  assert.equal(readiness.body.ready, true);
  assert.equal(readiness.body.e2eeActive, false);

  // ── 3) Dry run changes nothing ─────────────────────────────────────────────
  result = await dropPlaintext(householdId);
  assert.equal(result.status, 'dry-run');
  assert.equal((await Household.findById(householdId)).e2eeActive, false);
  assert.equal((await CalendarEvent.findById(event._id)).title, 'Dentist');

  // ── 4) COMMIT ──────────────────────────────────────────────────────────────
  result = await dropPlaintext(householdId, { commit: true });
  assert.equal(result.status, 'committed');

  const hhAfter = await Household.findById(householdId);
  assert.equal(hhAfter.e2eeActive, true);

  // Sealed records: plaintext content nulled, ciphertext intact.
  const eventAfter = await CalendarEvent.findById(event._id).lean();
  assert.equal(eventAfter.title, undefined);
  assert.ok(eventAfter.enc?.ct);
  const privAfter = await Trip.findById(privateTrip._id).lean();
  assert.equal(privAfter.name, undefined);
  assert.ok(privAfter.enc?.ct);
  const selves = await Person.find({ userId: { $in: [owner.user._id, member.user._id] } }).lean();
  assert.equal(selves.length, 2);
  for (const p of selves) {
    assert.equal(p.name, undefined);
    assert.ok(p.enc?.ct);
  }

  // The shared trip and its booking keep their plaintext.
  const sharedAfter = await Trip.findById(sharedTrip._id).lean();
  assert.equal(sharedAfter.name, 'Cousins camping');
  const sharedItemAfter = await TripItem.findById(sharedItem._id).lean();
  assert.equal(sharedItemAfter.title, 'Canoe rental');

  // Audit trail + idempotence.
  assert.ok(await AuditLog.findOne({ householdId, event: 'plaintext_dropped' }));
  assert.equal((await dropPlaintext(householdId, { commit: true })).status, 'already-active');

  // ── 5) The API, live with e2eeActive = true ────────────────────────────────
  const hhLive = await request().get('/api/household').set('Authorization', member.auth);
  assert.equal(hhLive.status, 200);
  assert.equal(hhLive.body.e2eeActive, true);

  // /calendar/raw serves enc-only records for client-side decrypt + expansion,
  // and its ensureSelf call must NOT re-create a plaintext self-Person.
  const raw = await request().get('/api/calendar/raw').set('Authorization', owner.auth);
  assert.equal(raw.status, 200);
  const rawEvent = (raw.body.events || []).find((e) => String(e._id) === String(event._id));
  assert.ok(rawEvent, 'the sealed event is still served');
  assert.equal(rawEvent.title, undefined);
  assert.ok(rawEvent.enc?.ct);
  assert.equal(await Person.countDocuments({ userId: { $in: [owner.user._id, member.user._id] } }), 2);

  // Creating content post-drop: the client mints the _id (the ciphertext AAD
  // binds to it) and sends enc alongside the schema-required plaintext columns.
  const create = await request().post('/api/calendar/events')
    .set('Authorization', member.auth)
    .send({
      _id: '66aabbccddeeff0011223344',
      calendarType: 'activities', title: 'sealed', startDate: '2026-08-15',
      enc: fakeEnc(), keyVersion: 1,
    });
  assert.equal(create.status, 201);

  // Readiness endpoint reports the live state.
  const readyAfter = await request().get('/api/household/e2ee/readiness').set('Authorization', owner.auth);
  assert.equal(readyAfter.body.e2eeActive, true);

  // No new stragglers.
  const strag = await request().get('/api/household/e2ee/stragglers').set('Authorization', owner.auth);
  assert.equal(strag.body.total, 0);
});
