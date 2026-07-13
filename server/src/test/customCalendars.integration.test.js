// Integration tests for custom calendars (routes/calendars.js): create/list,
// the three access tiers (private, shared with a member, shared household-wide),
// creator-only edit/delete, and the `mine` flag the client keys read-only mode
// off. Real app + in-memory MongoDB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, registerUser, enrollKeys, joinHousehold, b64u } = require('./harness');

before(startDb);
after(stopDb);

// One owner + one member in the same household, via the real onboarding flow.
async function setupHouseholdOfTwo() {
  const owner = await registerUser({ firstName: 'Olive' });
  const member = await registerUser({ firstName: 'Milo' });
  await enrollKeys(owner.auth);
  await enrollKeys(member.auth);
  const mint = await request().post('/api/household/key')
    .set('Authorization', owner.auth)
    .send({ keyVersion: 1, wrappedHDK: b64u(96) });
  assert.equal(mint.status, 201);
  const hh = await request().get('/api/household').set('Authorization', owner.auth);
  await joinHousehold({ joiner: member, approver: owner, keyVersion: 1 });
  return { owner, member };
}

let seq = 0;
const mintKey = () => `custom-test${Date.now().toString(36)}${(seq++).toString(36)}`;

async function createCalendar(auth, overrides = {}) {
  const res = await request().post('/api/calendars')
    .set('Authorization', auth)
    .send({ key: mintKey(), name: 'Test Calendar', color: '#1976D2', alertsEnabled: true, ...overrides });
  return res;
}

test('create + list: a private calendar is visible to its creator only', async () => {
  const { owner, member } = await setupHouseholdOfTwo();

  const created = await createCalendar(owner.auth, { name: 'Secret Plans' });
  assert.equal(created.status, 201);
  assert.equal(created.body.mine, true);

  const ownerList = await request().get('/api/calendars').set('Authorization', owner.auth);
  assert.ok(ownerList.body.some((c) => c.key === created.body.key));

  const memberList = await request().get('/api/calendars').set('Authorization', member.auth);
  assert.ok(!memberList.body.some((c) => c.key === created.body.key));
});

test('sharing tiers: household-wide and member-specific calendars reach the member (mine=false)', async () => {
  const { owner, member } = await setupHouseholdOfTwo();

  const hhWide = await createCalendar(owner.auth, { name: 'Family', sharedWithHousehold: true });
  const direct = await createCalendar(owner.auth, { name: 'Just Milo', sharedWith: [member.user._id] });
  const priv = await createCalendar(owner.auth, { name: 'Private' });

  const memberList = await request().get('/api/calendars').set('Authorization', member.auth);
  const keys = memberList.body.map((c) => c.key);
  assert.ok(keys.includes(hhWide.body.key));
  assert.ok(keys.includes(direct.body.key));
  assert.ok(!keys.includes(priv.body.key));
  for (const c of memberList.body) {
    if (c.key === hhWide.body.key || c.key === direct.body.key) assert.equal(c.mine, false);
  }
});

test('outsiders see nothing, even when a calendar is household-wide', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const outsider = await registerUser({ firstName: 'Randa' });

  const hhWide = await createCalendar(owner.auth, { sharedWithHousehold: true });
  assert.equal(hhWide.status, 201);

  const list = await request().get('/api/calendars').set('Authorization', outsider.auth);
  assert.equal(list.status, 200);
  assert.ok(!list.body.some((c) => c.key === hhWide.body.key));
});

test('creator-only writes: a member with read access cannot edit or delete', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth, { sharedWithHousehold: true });

  const memberEdit = await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', member.auth).send({ name: 'Hijacked' });
  assert.equal(memberEdit.status, 404);

  const memberDelete = await request().delete(`/api/calendars/${cal.body.key}`)
    .set('Authorization', member.auth);
  assert.equal(memberDelete.status, 404);

  const ownerEdit = await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth)
    .send({ name: 'Renamed', sharedWithHousehold: false, sharedWith: [member.user._id] });
  assert.equal(ownerEdit.status, 200);
  assert.equal(ownerEdit.body.name, 'Renamed');

  const ownerDelete = await request().delete(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth);
  assert.equal(ownerDelete.status, 200);

  const list = await request().get('/api/calendars').set('Authorization', owner.auth);
  assert.ok(!list.body.some((c) => c.key === cal.body.key));
});

test('validation: bad keys are rejected; duplicate keys conflict', async () => {
  const { owner } = await setupHouseholdOfTwo();

  const badKey = await createCalendar(owner.auth, { key: 'not-a-custom-key' });
  assert.equal(badKey.status, 400);

  const key = mintKey();
  const first = await createCalendar(owner.auth, { key });
  assert.equal(first.status, 201);
  const dup = await createCalendar(owner.auth, { key });
  assert.equal(dup.status, 400);
});

test('events can live on a custom calendar id', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth);

  const event = await request().post('/api/calendar/events')
    .set('Authorization', owner.auth)
    .send({ calendarType: cal.body.key, title: 'Practice', startDate: '2026-09-01T16:00:00.000Z', allDay: false });
  assert.equal(event.status, 201);
  assert.equal(event.body.calendarType, cal.body.key);
});

// ── Outside-household sharing (CalendarInvitation flow, §9.5) ────────────────

test('outside share: invitation lifecycle grants and revokes live event access', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const outsider = await registerUser({ firstName: 'Piper' });

  // Owner shares a calendar with the outsider's email + puts an event on it.
  const cal = await createCalendar(owner.auth, {
    name: 'Carpool',
    sharedWithOutside: [outsider.user.email.toUpperCase()], // case-insensitive
  });
  assert.equal(cal.status, 201);
  const event = await request().post('/api/calendar/events')
    .set('Authorization', owner.auth)
    .send({ calendarType: cal.body.key, title: 'Pickup', startDate: '2026-09-02T15:00:00.000Z', allDay: false });
  assert.equal(event.status, 201);

  // The outsider sees a pending invitation (resolved to their account).
  const inbox = await request().get('/api/calendars/invitations').set('Authorization', outsider.auth);
  assert.equal(inbox.status, 200);
  const inv = inbox.body.find((i) => i.calendarKey === cal.body.key);
  assert.ok(inv);
  assert.equal(inv.status, 'pending');
  assert.equal(inv.calendarName, 'Carpool');
  assert.equal(String(inv.toUserId), String(outsider.user._id));

  // Before accepting: no calendar, no events.
  let calList = await request().get('/api/calendars').set('Authorization', outsider.auth);
  assert.ok(!calList.body.some((c) => c.key === cal.body.key));

  // Accept → the calendar appears (read-only, sharing details stripped)…
  const accept = await request().post(`/api/calendars/invitations/${inv._id}/accept`)
    .set('Authorization', outsider.auth);
  assert.equal(accept.status, 200);
  assert.equal(accept.body.calendar.mine, false);
  calList = await request().get('/api/calendars').set('Authorization', outsider.auth);
  const shared = calList.body.find((c) => c.key === cal.body.key);
  assert.ok(shared);
  assert.equal(shared.mine, false);
  assert.deepEqual(shared.sharedWithOutside, []);
  assert.deepEqual(shared.sharedWith, []);
  assert.equal(shared.sharedWithHousehold, false);

  // …and the owner's event shows on the outsider's calendar range.
  const range = await request().get('/api/calendar')
    .set('Authorization', outsider.auth)
    .query({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' });
  assert.equal(range.status, 200);
  assert.ok(range.body.events.some((e) => e.title === 'Pickup'));

  // Default outside access is View Only: reads flag readOnly, writes 403.
  const detail = await request().get(`/api/calendar/events/${event.body._id}`)
    .set('Authorization', outsider.auth);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.readOnly, true);
  const edit = await request().put(`/api/calendar/events/${event.body._id}`)
    .set('Authorization', outsider.auth).send({ title: 'Hijacked' });
  assert.equal(edit.status, 403);

  // Owner removes the email → invitation deleted, access revoked.
  const unshare = await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth).send({ sharedWithOutside: [] });
  assert.equal(unshare.status, 200);
  const inbox2 = await request().get('/api/calendars/invitations').set('Authorization', outsider.auth);
  assert.ok(!inbox2.body.some((i) => i.calendarKey === cal.body.key));
  calList = await request().get('/api/calendars').set('Authorization', outsider.auth);
  assert.ok(!calList.body.some((c) => c.key === cal.body.key));
  const range2 = await request().get('/api/calendar')
    .set('Authorization', outsider.auth)
    .query({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' });
  assert.ok(!range2.body.events.some((e) => e.title === 'Pickup'));
});

test('outside share: decline grants nothing; declining after accept gives up access', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const outsider = await registerUser({ firstName: 'Quinn' });

  const cal = await createCalendar(owner.auth, { sharedWithOutside: [outsider.user.email] });
  const inbox = await request().get('/api/calendars/invitations').set('Authorization', outsider.auth);
  const inv = inbox.body.find((i) => i.calendarKey === cal.body.key);

  const decline = await request().post(`/api/calendars/invitations/${inv._id}/decline`)
    .set('Authorization', outsider.auth);
  assert.equal(decline.status, 200);
  assert.equal(decline.body.invitation.status, 'declined');
  let calList = await request().get('/api/calendars').set('Authorization', outsider.auth);
  assert.ok(!calList.body.some((c) => c.key === cal.body.key));

  // Accept, then decline again → access removed.
  await request().post(`/api/calendars/invitations/${inv._id}/accept`).set('Authorization', outsider.auth);
  calList = await request().get('/api/calendars').set('Authorization', outsider.auth);
  assert.ok(calList.body.some((c) => c.key === cal.body.key));
  await request().post(`/api/calendars/invitations/${inv._id}/decline`).set('Authorization', outsider.auth);
  calList = await request().get('/api/calendars').set('Authorization', outsider.auth);
  assert.ok(!calList.body.some((c) => c.key === cal.body.key));
});

test('outside share: an email without an account is claimed at registration', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const email = `future-${Date.now()}@example.com`;

  const cal = await createCalendar(owner.auth, { sharedWithOutside: [email] });
  assert.equal(cal.status, 201);

  const late = await registerUser({ email, firstName: 'Late' });
  const inbox = await request().get('/api/calendars/invitations').set('Authorization', late.auth);
  const inv = inbox.body.find((i) => i.calendarKey === cal.body.key);
  assert.ok(inv);

  const accept = await request().post(`/api/calendars/invitations/${inv._id}/accept`)
    .set('Authorization', late.auth);
  assert.equal(accept.status, 200);
  const calList = await request().get('/api/calendars').set('Authorization', late.auth);
  assert.ok(calList.body.some((c) => c.key === cal.body.key));
});

// ── Access levels: View Only vs Full Access ──────────────────────────────────

test('member access levels: view-only blocks event writes; full access allows them', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth, {
    name: 'Projects',
    sharedWith: [{ userId: member.user._id, access: 'view' }],
  });
  const event = await request().post('/api/calendar/events')
    .set('Authorization', owner.auth)
    .send({ calendarType: cal.body.key, title: 'Kickoff', startDate: '2026-09-03T10:00:00.000Z', allDay: false });
  assert.equal(event.status, 201);

  // The member sees the calendar with access: 'view'…
  const list = await request().get('/api/calendars').set('Authorization', member.auth);
  const seen = list.body.find((c) => c.key === cal.body.key);
  assert.equal(seen.access, 'view');

  // …reads the event flagged readOnly, and can't write.
  const detail = await request().get(`/api/calendar/events/${event.body._id}`).set('Authorization', member.auth);
  assert.equal(detail.body.readOnly, true);
  const edit = await request().put(`/api/calendar/events/${event.body._id}`)
    .set('Authorization', member.auth).send({ title: 'Nope' });
  assert.equal(edit.status, 403);
  const del = await request().delete(`/api/calendar/events/${event.body._id}`).set('Authorization', member.auth);
  assert.equal(del.status, 403);
  const create = await request().post('/api/calendar/events')
    .set('Authorization', member.auth)
    .send({ calendarType: cal.body.key, title: 'Sneaky', startDate: '2026-09-04T10:00:00.000Z' });
  assert.equal(create.status, 403);

  // Owner upgrades to full access → the member can now write.
  const upgrade = await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth)
    .send({ sharedWith: [{ userId: member.user._id, access: 'full' }] });
  assert.equal(upgrade.status, 200);
  const edit2 = await request().put(`/api/calendar/events/${event.body._id}`)
    .set('Authorization', member.auth).send({ title: 'Renamed by member' });
  assert.equal(edit2.status, 200);
  assert.equal(edit2.body.title, 'Renamed by member');
});

test('household-wide view-only calendar: members read but cannot write; the owner still can', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth, {
    name: 'Announcements',
    sharedWithHousehold: true,
    householdAccess: 'view',
  });
  const event = await request().post('/api/calendar/events')
    .set('Authorization', owner.auth)
    .send({ calendarType: cal.body.key, title: 'Read me', startDate: '2026-09-05T10:00:00.000Z' });
  assert.equal(event.status, 201);

  const list = await request().get('/api/calendars').set('Authorization', member.auth);
  assert.equal(list.body.find((c) => c.key === cal.body.key).access, 'view');

  const memberEdit = await request().put(`/api/calendar/events/${event.body._id}`)
    .set('Authorization', member.auth).send({ title: 'Nope' });
  assert.equal(memberEdit.status, 403);
  const ownerEdit = await request().put(`/api/calendar/events/${event.body._id}`)
    .set('Authorization', owner.auth).send({ title: 'Still mine' });
  assert.equal(ownerEdit.status, 200);
});

test('full-access outside collaborator can create and edit events; the owner sees them', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const outsider = await registerUser({ firstName: 'Remy' });

  const cal = await createCalendar(owner.auth, {
    name: 'Co-parenting',
    sharedWithOutside: [{ email: outsider.user.email, access: 'full' }],
  });
  const inbox = await request().get('/api/calendars/invitations').set('Authorization', outsider.auth);
  const inv = inbox.body.find((i) => i.calendarKey === cal.body.key);
  assert.equal(inv.access, 'full');
  await request().post(`/api/calendars/invitations/${inv._id}/accept`).set('Authorization', outsider.auth);

  // Collaborator creates an event on the shared calendar…
  const created = await request().post('/api/calendar/events')
    .set('Authorization', outsider.auth)
    .send({ calendarType: cal.body.key, title: 'Pickup swap', startDate: '2026-09-06T09:00:00.000Z', allDay: false });
  assert.equal(created.status, 201);

  // …the owner sees it on their range and can edit it; the collaborator can
  // edit the owner's events too (no readOnly flag).
  const ownerRange = await request().get('/api/calendar')
    .set('Authorization', owner.auth)
    .query({ from: '2026-09-05T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' });
  assert.ok(ownerRange.body.events.some((e) => e.title === 'Pickup swap'));
  const ownerEdit = await request().put(`/api/calendar/events/${created.body._id}`)
    .set('Authorization', owner.auth).send({ title: 'Pickup swap (moved)' });
  assert.equal(ownerEdit.status, 200);

  const detail = await request().get(`/api/calendar/events/${created.body._id}`).set('Authorization', outsider.auth);
  assert.equal(detail.body.readOnly, undefined);

  // Owner downgrades to view → the collaborator's writes stop.
  await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth)
    .send({ sharedWithOutside: [{ email: outsider.user.email, access: 'view' }] });
  const blocked = await request().put(`/api/calendar/events/${created.body._id}`)
    .set('Authorization', outsider.auth).send({ title: 'Nope' });
  assert.equal(blocked.status, 403);
});

// ── Subscribed (ICS feed) calendars ──────────────────────────────────────────

test('feed subscription: webcal:// normalizes to https and is stored', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth, {
    name: 'School',
    sharedWithHousehold: true,
    feedUrl: 'webcal://example.com/school.ics',
  });
  assert.equal(cal.status, 201);
  assert.equal(cal.body.feedUrl, 'https://example.com/school.ics');

  // The URL flows to a housemate so their device can fetch the feed itself.
  const list = await request().get('/api/calendars').set('Authorization', member.auth);
  const seen = list.body.find((c) => c.key === cal.body.key);
  assert.equal(seen.feedUrl, 'https://example.com/school.ics');
});

test('feed subscription: a non-http(s) feed URL is rejected', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const bad = await createCalendar(owner.auth, { feedUrl: 'ftp://example.com/x.ics' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_feed_url');
});

test('feed subscription: events are read-only — even the owner cannot write', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth, {
    name: 'Sports',
    sharedWithHousehold: true,
    feedUrl: 'https://example.com/sports.ics',
  });
  assert.equal(cal.status, 201);

  // The owner (full access to every other custom calendar) cannot create an
  // event here — the feed is the sole source of its events.
  const ownerCreate = await request().post('/api/calendar/events')
    .set('Authorization', owner.auth)
    .send({ calendarType: cal.body.key, title: 'Injected', startDate: '2026-09-01T16:00:00.000Z' });
  assert.equal(ownerCreate.status, 403);

  // And a housemate likewise cannot write.
  const memberCreate = await request().post('/api/calendar/events')
    .set('Authorization', member.auth)
    .send({ calendarType: cal.body.key, title: 'Injected', startDate: '2026-09-01T16:00:00.000Z' });
  assert.equal(memberCreate.status, 403);
});

// ── Holiday calendars (client-computed, read-only, shareable) ────────────────

test('holiday calendar: config is stored and reaches a housemate', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth, {
    name: 'Canadian Holidays',
    sharedWithHousehold: true,
    holiday: { country: 'CA', selectedRegions: ['Ontario'], disabledIds: ['boxing-day'] },
  });
  assert.equal(cal.status, 201);
  assert.equal(cal.body.holiday.country, 'CA');
  assert.deepEqual(cal.body.holiday.selectedRegions, ['Ontario']);

  const list = await request().get('/api/calendars').set('Authorization', member.auth);
  const seen = list.body.find((c) => c.key === cal.body.key);
  assert.ok(seen);
  assert.equal(seen.holiday.country, 'CA');
  assert.deepEqual(seen.holiday.disabledIds, ['boxing-day']);
});

test('holiday calendar: events are read-only — even the owner cannot write', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth, {
    name: 'US Holidays',
    sharedWithHousehold: true,
    holiday: { country: 'US', selectedRegions: [], disabledIds: [] },
  });
  assert.equal(cal.status, 201);

  const ownerCreate = await request().post('/api/calendar/events')
    .set('Authorization', owner.auth)
    .send({ calendarType: cal.body.key, title: 'Injected', startDate: '2026-07-04T12:00:00.000Z' });
  assert.equal(ownerCreate.status, 403);

  const memberCreate = await request().post('/api/calendar/events')
    .set('Authorization', member.auth)
    .send({ calendarType: cal.body.key, title: 'Injected', startDate: '2026-07-04T12:00:00.000Z' });
  assert.equal(memberCreate.status, 403);
});

test('holiday calendar: owner can edit its regions/disabled config', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth, {
    name: 'UK Holidays',
    holiday: { country: 'GB', selectedRegions: [], disabledIds: [] },
  });
  const edit = await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth)
    .send({ holiday: { selectedRegions: ['Scotland'], disabledIds: [] } });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.holiday.country, 'GB'); // country preserved
  assert.deepEqual(edit.body.holiday.selectedRegions, ['Scotland']);
});

test('outside share fails safe on an E2EE-active household (409 decrypt_required)', async () => {
  const { owner } = await setupHouseholdOfTwo();
  const cal = await createCalendar(owner.auth);

  const Household = require('../models/Household');
  const hh = await request().get('/api/household').set('Authorization', owner.auth);
  await Household.updateOne({ _id: hh.body._id }, { $set: { e2eeActive: true } });

  const blocked = await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth).send({ sharedWithOutside: ['friend@example.com'] });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'decrypt_required');

  // Non-sharing edits still work.
  const rename = await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth).send({ name: 'Still Editable' });
  assert.equal(rename.status, 200);

  await Household.updateOne({ _id: hh.body._id }, { $set: { e2eeActive: false } });
});
