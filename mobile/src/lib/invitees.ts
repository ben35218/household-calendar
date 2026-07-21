import { invitationsApi, EventInvitation, InvitationEventSnapshot } from '../api';
import { sealInvitationSnapshot } from './e2ee';
import { API_URL } from '../config';

// Cross-household event invitees, addressed by email or by phone (SMS). Email
// and phone entries stage identically (EventInviteesScreen) and send together:
// on the Invitees screen's ✓ for a saved event, or right after save for a new
// one (EventFormScreen). Emails are sent server-side; texts are sent from the
// user's own device — the server records the invitation and the Messages
// composer opens prefilled with the event and its public .ics link.

export type InviteeEntry = { email?: string; phone?: string };

export const inviteeKey = (e: InviteeEntry) => e.email ?? e.phone ?? '';

// Mirrors the server's normalization so dedupe checks agree with what it stores.
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (s.startsWith('+') ? '+' : '') + digits;
}

export function formatWhen(s: InvitationEventSnapshot): string {
  const d = new Date(s.startDate);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (s.allDay !== false) return date;
  return `${date} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// Prefilled Messages composer: the user sends the text themselves, from their
// own number. The link is the invitation's public .ics download. Resolves when
// the composer closes, so texts can be sequenced one per invitee.
export async function composeSmsInvite(
  phone: string,
  inv: EventInvitation,
  snapshot: InvitationEventSnapshot,
) {
  // expo-sms is a native module — require it lazily so JS bundles still boot
  // on dev clients built before it was added (those fail here, when a text is
  // actually attempted, instead of at app launch).
  let SMS: typeof import('expo-sms');
  try {
    SMS = require('expo-sms');
  } catch {
    throw new Error('This app build has no text-message support — rebuild the app');
  }
  if (!(await SMS.isAvailableAsync())) {
    throw new Error('Text messaging is not available on this device');
  }
  const link = `${API_URL}/invitations/public/${inv._id}/ics?k=${inv.shareToken}`;
  const body = `Join me for “${snapshot.title}” on ${formatWhen(snapshot)}. Tap to add it to your calendar: ${link}`;
  await SMS.sendSMSAsync([phone], body);
}

// Send a batch of staged entries for a saved event. Emails go out in parallel;
// texts run one at a time — each opens the Messages composer and waits for it
// to close. Returns the entries that failed (with why) so callers can keep
// them staged.
export async function sendInvitations(
  eventId: string,
  entries: InviteeEntry[],
  snapshot: InvitationEventSnapshot,
): Promise<{ entry: InviteeEntry; error: string }[]> {
  const failures: { entry: InviteeEntry; error: string }[] = [];
  const reason = (e: any) => e?.response?.data?.error || e?.message || 'could not send the invitation';

  await Promise.all(
    entries
      .filter((e) => e.email)
      .map(async (entry) => {
        try {
          // D3: if the invitee is a known account with enrolled keys, seal the
          // snapshot to their identity key on-device — the server never sees the
          // plaintext. Otherwise (no account / no keys) fall back to the
          // plaintext lane, which the emailed .ics still needs.
          let pub: string | null = null;
          try {
            pub = (await invitationsApi.lookup(entry.email!)).data.identityPublicKey;
          } catch { /* lookup failed → plaintext lane */ }
          if (pub) {
            const sealedEvent = await sealInvitationSnapshot(snapshot, pub);
            await invitationsApi.send({ eventId, email: entry.email, sealedEvent });
          } else {
            await invitationsApi.send({ eventId, email: entry.email, event: snapshot });
          }
        } catch (e: any) {
          failures.push({ entry, error: reason(e) });
        }
      }),
  );

  for (const entry of entries.filter((e) => e.phone)) {
    try {
      const inv = (await invitationsApi.send({ eventId, phone: entry.phone, event: snapshot })).data
        .invitation;
      await composeSmsInvite(inv.toPhone ?? entry.phone!, inv, snapshot);
    } catch (e: any) {
      failures.push({ entry, error: reason(e) });
    }
  }

  return failures;
}
