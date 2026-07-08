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
