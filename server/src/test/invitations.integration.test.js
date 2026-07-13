// Integration tests for cross-household event invitations (routes/invitations.js):
// invite by email (registered vs. unknown address), the recipient's New/Replied
// lifecycle (accept copies the event onto their calendar; decline doesn't), the
// late-registration claim of email-only invites, the .ics download, and the
// guard rails (self, same household, out-of-scope event, bad email).
// Real app + in-memory MongoDB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, registerUser } = require('./harness');

const CalendarEvent = require('../models/CalendarEvent');

before(startDb);
after(stopDb);

// A sender with one plain calendar event; returns the invite payload the mobile
// client would post (client-supplied plaintext snapshot alongside the eventId).
async function setupSenderWithEvent() {
  const sender = await registerUser({ firstName: 'Ada', lastName: 'Sender' });
  const res = await request().post('/api/calendar/events')
    .set('Authorization', sender.auth)
    .send({
      calendarType: 'activities', title: 'Lake day', location: 'Sandbanks',
      description: 'Bring sunscreen', startDate: '2026-08-15T12:00:00.000Z', allDay: true,
    });
  assert.equal(res.status, 201);
  const snapshot = {
    title: 'Lake day', location: 'Sandbanks', description: 'Bring sunscreen',
    startDate: '2026-08-15T12:00:00.000Z', allDay: true, calendarType: 'activities',
  };
  return { sender, eventId: res.body._id, snapshot };
}

test('invite a registered user → pending invitation, resolved recipient, no duplicates on resend', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser({ firstName: 'Ben', lastName: 'Recipient' });

  const res = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email.toUpperCase(), event: snapshot });
  assert.equal(res.status, 201);
  assert.equal(res.body.userExists, true);
  assert.equal(res.body.invitation.status, 'pending');
  assert.equal(res.body.invitation.toEmail, recipient.user.email);
  assert.equal(String(res.body.invitation.toUserId), String(recipient.user._id));
  assert.equal(res.body.invitation.event.title, 'Lake day');

  // Resending to the same address refreshes the pending invite, not a new row.
  const again = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot });
  assert.equal(again.status, 201);
  const list = await request().get('/api/invitations').set('Authorization', recipient.auth);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
});

test('accept copies the event onto the recipient calendar and moves the invite to Replied', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser();
  const sent = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot });
  const invId = sent.body.invitation._id;

  const res = await request().post(`/api/invitations/${invId}/accept`).set('Authorization', recipient.auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.invitation.status, 'accepted');
  assert.equal(String(res.body.event.userId), String(recipient.user._id));
  assert.equal(res.body.event.title, 'Lake day');

  // The copy is independent — the sender's original is untouched.
  const original = await CalendarEvent.findById(eventId).lean();
  assert.equal(String(original.userId), String(sender.user._id));
  assert.notEqual(String(original._id), String(res.body.event._id));

  // The recipient can read their copy through the normal calendar API.
  const mine = await request().get(`/api/calendar/events/${res.body.event._id}`).set('Authorization', recipient.auth);
  assert.equal(mine.status, 200);

  // Replying twice is rejected, and the invite now lives in Replied.
  const twice = await request().post(`/api/invitations/${invId}/decline`).set('Authorization', recipient.auth);
  assert.equal(twice.status, 400);
  const list = await request().get('/api/invitations').set('Authorization', recipient.auth);
  assert.equal(list.body[0].status, 'accepted');
});

test('decline records the reply without creating an event', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser();
  const sent = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot });

  const res = await request().post(`/api/invitations/${sent.body.invitation._id}/decline`)
    .set('Authorization', recipient.auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.invitation.status, 'declined');
  const copies = await CalendarEvent.find({ userId: recipient.user._id, title: 'Lake day' }).lean();
  assert.equal(copies.length, 0);
});

test('email-only invite (no account) is claimed when that user registers later', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const email = 'future-user@example.com';

  const sent = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email, event: snapshot });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.userExists, false);
  assert.equal(sent.body.invitation.toUserId ?? null, null);

  const lateUser = await registerUser({ email });
  const list = await request().get('/api/invitations').set('Authorization', lateUser.auth);
  assert.equal(list.body.length, 1);
  assert.equal(String(list.body[0].toUserId), String(lateUser.user._id));
  assert.equal(list.body[0].status, 'pending');
});

test('.ics download renders the snapshot as an all-day VEVENT', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser();
  const sent = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot });

  const res = await request().get(`/api/invitations/${sent.body.invitation._id}/ics`)
    .set('Authorization', recipient.auth);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/calendar/);
  assert.match(res.text, /SUMMARY:Lake day/);
  assert.match(res.text, /DTSTART;VALUE=DATE:20260815/);
  assert.match(res.text, /LOCATION:Sandbanks/);
});

test('organizer invitee list: visible in event scope only, tracks the accept linkage', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser();
  await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot });
  await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: 'other@example.com', event: snapshot });

  // The organizer sees every invitee for the event…
  let sent = await request().get('/api/invitations/sent').query({ eventId }).set('Authorization', sender.auth);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.length, 2);

  // …the recipient does not (the source event isn't in their scope), and their
  // accepted copy has a different id that maps to no invitations.
  const denied = await request().get('/api/invitations/sent').query({ eventId }).set('Authorization', recipient.auth);
  assert.equal(denied.status, 404);

  const inv = sent.body.find((i) => i.toEmail === recipient.user.email);
  const accepted = await request().post(`/api/invitations/${inv._id}/accept`).set('Authorization', recipient.auth);
  assert.equal(String(accepted.body.event.invitationId), String(inv._id));
  const viaCopy = await request().get('/api/invitations/sent')
    .query({ eventId: accepted.body.event._id }).set('Authorization', recipient.auth);
  assert.equal(viaCopy.status, 200);
  assert.equal(viaCopy.body.length, 0);

  sent = await request().get('/api/invitations/sent').query({ eventId }).set('Authorization', sender.auth);
  const row = sent.body.find((i) => i.toEmail === recipient.user.email);
  assert.equal(row.status, 'accepted');
  assert.equal(String(row.acceptedEventId), String(accepted.body.event._id));
});

test('leave deletes the recipient copy and retires the invitation to left', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser();
  const inv = (await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot })).body.invitation;

  // Leaving before accepting is rejected.
  const early = await request().post(`/api/invitations/${inv._id}/leave`).set('Authorization', recipient.auth);
  assert.equal(early.status, 400);

  const accepted = await request().post(`/api/invitations/${inv._id}/accept`).set('Authorization', recipient.auth);
  const copyId = accepted.body.event._id;

  const left = await request().post(`/api/invitations/${inv._id}/leave`).set('Authorization', recipient.auth);
  assert.equal(left.status, 200);
  assert.equal(left.body.invitation.status, 'left');
  assert.equal(await CalendarEvent.findById(copyId), null);

  // The organizer's list still records the invitee (as left); the original stays.
  const sent = await request().get('/api/invitations/sent').query({ eventId }).set('Authorization', sender.auth);
  assert.equal(sent.body[0].status, 'left');
  assert.notEqual(await CalendarEvent.findById(eventId), null);
});

test('organizer revoke removes the invitation — and the copy if it was accepted', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser();

  // Pending revoke: the invite vanishes from the recipient's inbox.
  const pending = (await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot })).body.invitation;

  // Only the organizer side can revoke.
  const notYours = await request().delete(`/api/invitations/${pending._id}`).set('Authorization', recipient.auth);
  assert.equal(notYours.status, 404);

  const revoked = await request().delete(`/api/invitations/${pending._id}`).set('Authorization', sender.auth);
  assert.equal(revoked.status, 200);
  const inbox = await request().get('/api/invitations').set('Authorization', recipient.auth);
  assert.equal(inbox.body.length, 0);

  // Accepted revoke: the recipient's copy goes too.
  const again = (await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot })).body.invitation;
  const accepted = await request().post(`/api/invitations/${again._id}/accept`).set('Authorization', recipient.auth);
  await request().delete(`/api/invitations/${again._id}`).set('Authorization', sender.auth);
  assert.equal(await CalendarEvent.findById(accepted.body.event._id), null);
});

test('an invited copy is read-only for the recipient — leave is the only exit; the original stays editable', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser();
  const inv = (await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot })).body.invitation;
  const accepted = await request().post(`/api/invitations/${inv._id}/accept`).set('Authorization', recipient.auth);
  const copyId = accepted.body.event._id;

  const edit = await request().put(`/api/calendar/events/${copyId}`)
    .set('Authorization', recipient.auth).send({ title: 'Hijacked' });
  assert.equal(edit.status, 403);
  const del = await request().delete(`/api/calendar/events/${copyId}`).set('Authorization', recipient.auth);
  assert.equal(del.status, 403);
  assert.equal((await CalendarEvent.findById(copyId).lean()).title, 'Lake day');

  // The organizer's household still edits (and could delete) the original.
  const orig = await request().put(`/api/calendar/events/${eventId}`)
    .set('Authorization', sender.auth).send({ title: 'Lake day (moved)' });
  assert.equal(orig.status, 200);
  assert.equal(orig.body.title, 'Lake day (moved)');

  // Leave still works — the sanctioned way out for the invitee.
  const left = await request().post(`/api/invitations/${inv._id}/leave`).set('Authorization', recipient.auth);
  assert.equal(left.status, 200);
  assert.equal(await CalendarEvent.findById(copyId), null);
});

test('phone invite: normalized number, no account resolution, no duplicates on resend', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();

  const res = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, phone: '+1 (415) 555-0134', event: snapshot });
  assert.equal(res.status, 201);
  assert.equal(res.body.userExists, false);
  assert.equal(res.body.invitation.toPhone, '+14155550134');
  assert.equal(res.body.invitation.toEmail ?? null, null);
  assert.equal(res.body.invitation.toUserId ?? null, null);
  assert.equal(res.body.invitation.status, 'pending');
  assert.ok(res.body.invitation.shareToken);

  // Re-inviting the same number (formatted differently) refreshes in place.
  const again = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, phone: '+1 415.555.0134', event: snapshot });
  assert.equal(again.status, 201);
  assert.equal(String(again.body.invitation._id), String(res.body.invitation._id));

  const sent = await request().get('/api/invitations/sent').query({ eventId }).set('Authorization', sender.auth);
  assert.equal(sent.body.length, 1);

  // Too short / empty numbers are rejected.
  const bad = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, phone: '12345', event: snapshot });
  assert.equal(bad.status, 400);
});

test('public .ics link: shareToken grants unauthenticated download, wrong token does not', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const inv = (await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, phone: '+14155550134', event: snapshot })).body.invitation;

  const res = await request().get(`/api/invitations/public/${inv._id}/ics`).query({ k: inv.shareToken });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/calendar/);
  assert.match(res.text, /SUMMARY:Lake day/);

  const wrong = await request().get(`/api/invitations/public/${inv._id}/ics`)
    .query({ k: 'f'.repeat(inv.shareToken.length) });
  assert.equal(wrong.status, 404);
  const missing = await request().get(`/api/invitations/public/${inv._id}/ics`);
  assert.equal(missing.status, 404);
});

test('guard rails: self-invite, same-household recipient, bad email, out-of-scope event', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();

  const self = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: sender.user.email, event: snapshot });
  assert.equal(self.status, 400);

  const bad = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: 'not-an-email', event: snapshot });
  assert.equal(bad.status, 400);

  // A stranger can't invite off someone else's event (not in their scope).
  const stranger = await registerUser();
  const outOfScope = await request().post('/api/invitations')
    .set('Authorization', stranger.auth)
    .send({ eventId, email: 'anyone@example.com', event: snapshot });
  assert.equal(outOfScope.status, 404);

  // A recipient inside the sender's own household already sees the event.
  const housemate = await registerUser();
  const User = require('../models/User');
  await User.updateOne({ _id: housemate.user._id }, { $set: { householdId: sender.user.householdId } });
  const sameHouse = await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: housemate.user.email, event: snapshot });
  assert.equal(sameHouse.status, 400);
  assert.match(sameHouse.body.error, /household/);
});

test('guest list: invitees see who else is invited unless the organizer turns it off', async () => {
  const { sender, eventId, snapshot } = await setupSenderWithEvent();
  const recipient = await registerUser();
  const inv = (await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: recipient.user.email, event: snapshot })).body.invitation;
  await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, email: 'other@example.com', event: snapshot });
  await request().post('/api/invitations')
    .set('Authorization', sender.auth)
    .send({ eventId, phone: '+14155550134', event: snapshot });

  // Default: visible — the recipient sees every sibling invite (email and
  // phone), the organizer's identity, and no capability secrets.
  const res = await request().get(`/api/invitations/${inv._id}/guests`).set('Authorization', recipient.auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.visible, true);
  assert.equal(res.body.organizer.email, sender.user.email);
  assert.equal(res.body.guests.length, 3);
  const addresses = res.body.guests.map((g) => g.toEmail ?? g.toPhone).sort();
  assert.deepEqual(addresses, ['+14155550134', 'other@example.com', recipient.user.email].sort());
  assert.ok(res.body.guests.every((g) => g.shareToken === undefined));

  // Only someone the invitation is addressed to can ask.
  const stranger = await registerUser();
  const denied = await request().get(`/api/invitations/${inv._id}/guests`).set('Authorization', stranger.auth);
  assert.equal(denied.status, 404);

  // An event predating the flag (field absent) reads as visible.
  await CalendarEvent.updateOne({ _id: eventId }, { $unset: { guestListVisible: '' } });
  const legacy = await request().get(`/api/invitations/${inv._id}/guests`).set('Authorization', recipient.auth);
  assert.equal(legacy.body.visible, true);

  // The organizer flips guestListVisible off → the list goes dark.
  const off = await request().put(`/api/calendar/events/${eventId}`)
    .set('Authorization', sender.auth).send({ guestListVisible: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.guestListVisible, false);
  const hidden = await request().get(`/api/invitations/${inv._id}/guests`).set('Authorization', recipient.auth);
  assert.equal(hidden.status, 200);
  assert.deepEqual(hidden.body, { visible: false, guests: [] });

  // Back on — and RSVP statuses ride along once the recipient accepts.
  await request().put(`/api/calendar/events/${eventId}`)
    .set('Authorization', sender.auth).send({ guestListVisible: true });
  await request().post(`/api/invitations/${inv._id}/accept`).set('Authorization', recipient.auth);
  const after = await request().get(`/api/invitations/${inv._id}/guests`).set('Authorization', recipient.auth);
  assert.equal(after.body.visible, true);
  assert.equal(after.body.guests.find((g) => g.toEmail === recipient.user.email).status, 'accepted');

  // A deleted source event hides the list (nothing left to gate on).
  await request().delete(`/api/calendar/events/${eventId}`).set('Authorization', sender.auth);
  const gone = await request().get(`/api/invitations/${inv._id}/guests`).set('Authorization', recipient.auth);
  assert.equal(gone.body.visible, false);
});
