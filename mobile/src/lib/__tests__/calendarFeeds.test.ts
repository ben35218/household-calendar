jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../calendarPrefs', () => ({ getSubscribedCalendars: jest.fn() }));

import {
  normalizeFeedUrl,
  previewFeed,
  getFeedEvents,
  getFeedEventById,
  FeedError,
} from '../calendarFeeds';
import { getSubscribedCalendars } from '../calendarPrefs';

const mockSubs = getSubscribedCalendars as jest.Mock;

// Wrap VEVENT/VTIMEZONE bodies in a VCALENDAR envelope.
function ics(body: string, calName?: string) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    ...(calName ? [`X-WR-CALNAME:${calName}`] : []),
    body.trim(),
    'END:VCALENDAR',
  ].join('\r\n');
}

const TORONTO_VTIMEZONE = `
BEGIN:VTIMEZONE
TZID:America/Toronto
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

// Each test uses a distinct calendar id: the module caches fetched ICS per id
// for the life of the process (by design), so ids can't be reused across
// fixtures.
function feedOf(id: string, icsText: string) {
  mockSubs.mockResolvedValue([{ id, feedUrl: 'https://example.com/cal.ics', mine: true }]);
  (globalThis as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(icsText),
  });
}

const WINDOW = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' };

describe('normalizeFeedUrl', () => {
  it('rewrites webcal:// to https:// and trims', () => {
    expect(normalizeFeedUrl('  webcal://example.com/basic.ics ')).toBe('https://example.com/basic.ics');
    expect(normalizeFeedUrl('http://example.com/a.ics')).toBe('http://example.com/a.ics');
  });

  it('rejects non-http(s) input', () => {
    for (const bad of ['', 'garbage', 'ftp://example.com/a.ics', 'file:///etc/passwd']) {
      expect(() => normalizeFeedUrl(bad)).toThrow(FeedError);
    }
  });
});

describe('getFeedEvents', () => {
  it('converts a timed TZID event to the correct UTC instant', async () => {
    feedOf('custom-tz1', ics(`${TORONTO_VTIMEZONE}
BEGIN:VEVENT
UID:tz1@test
DTSTART;TZID=America/Toronto:20260715T100000
DTEND;TZID=America/Toronto:20260715T110000
SUMMARY:Dentist
LOCATION:123 Main St
END:VEVENT`));
    const events = await getFeedEvents(WINDOW);
    expect(events).toHaveLength(1);
    // July in Toronto is EDT (UTC-4).
    expect(events[0].startDate).toBe('2026-07-15T14:00:00.000Z');
    expect(events[0].endDate).toBe('2026-07-15T15:00:00.000Z');
    expect(events[0].allDay).toBe(false);
    expect(events[0].title).toBe('Dentist');
    expect(events[0].location).toBe('123 Main St');
    expect(events[0].readOnly).toBe(true);
    expect(events[0].calendarType).toBe('custom-tz1');
  });

  it('maps a single all-day event to noon UTC with no endDate', async () => {
    feedOf('custom-ad1', ics(`
BEGIN:VEVENT
UID:ad1@test
DTSTART;VALUE=DATE:20260710
DTEND;VALUE=DATE:20260711
SUMMARY:Holiday
END:VEVENT`));
    const events = await getFeedEvents(WINDOW);
    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
    expect(events[0].startDate).toBe('2026-07-10T12:00:00.000Z');
    expect(events[0].endDate).toBeUndefined();
  });

  it('converts an exclusive all-day DTEND to an inclusive endDate', async () => {
    feedOf('custom-ad2', ics(`
BEGIN:VEVENT
UID:ad2@test
DTSTART;VALUE=DATE:20260710
DTEND;VALUE=DATE:20260713
SUMMARY:Long weekend
END:VEVENT`));
    const events = await getFeedEvents(WINDOW);
    expect(events).toHaveLength(1);
    expect(events[0].startDate).toBe('2026-07-10T12:00:00.000Z');
    expect(events[0].endDate).toBe('2026-07-12T12:00:00.000Z');
  });

  it('expands a weekly RRULE and honours EXDATE', async () => {
    feedOf('custom-rr1', ics(`
BEGIN:VEVENT
UID:rr1@test
DTSTART:20260701T170000Z
DTEND:20260701T180000Z
RRULE:FREQ=WEEKLY;BYDAY=WE
EXDATE:20260715T170000Z
SUMMARY:Soccer
END:VEVENT`));
    const events = await getFeedEvents(WINDOW);
    // Wednesdays in July 2026: 1, 8, 15 (excluded), 22, 29.
    expect(events.map((e) => e.startDate)).toEqual([
      '2026-07-01T17:00:00.000Z',
      '2026-07-08T17:00:00.000Z',
      '2026-07-22T17:00:00.000Z',
      '2026-07-29T17:00:00.000Z',
    ]);
  });

  it('applies a RECURRENCE-ID override to just that occurrence', async () => {
    feedOf('custom-ov1', ics(`
BEGIN:VEVENT
UID:ov1@test
DTSTART:20260706T090000Z
DTEND:20260706T093000Z
RRULE:FREQ=WEEKLY;BYDAY=MO
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:ov1@test
RECURRENCE-ID:20260713T090000Z
DTSTART:20260713T140000Z
DTEND:20260713T143000Z
SUMMARY:Standup (moved)
END:VEVENT`));
    const events = await getFeedEvents(WINDOW);
    const moved = events.find((e) => e.title === 'Standup (moved)');
    expect(moved?.startDate).toBe('2026-07-13T14:00:00.000Z');
    // The other occurrences keep the master's time and title.
    const regular = events.filter((e) => e.title === 'Standup');
    expect(regular.map((e) => e.startDate)).toEqual([
      '2026-07-06T09:00:00.000Z',
      '2026-07-20T09:00:00.000Z',
      '2026-07-27T09:00:00.000Z',
    ]);
  });

  it('clips an infinite RRULE to the window', async () => {
    feedOf('custom-inf1', ics(`
BEGIN:VEVENT
UID:inf1@test
DTSTART;VALUE=DATE:20200101
RRULE:FREQ=DAILY
SUMMARY:Forever
END:VEVENT`));
    const events = await getFeedEvents(WINDOW);
    expect(events).toHaveLength(31); // one per July day, nothing outside
    expect(events[0].startDate).toBe('2026-07-01T12:00:00.000Z');
    expect(events[events.length - 1].startDate).toBe('2026-07-31T12:00:00.000Z');
  });

  it('round-trips occurrence ids through getFeedEventById, UID colons included', async () => {
    feedOf('custom-id1', ics(`
BEGIN:VEVENT
UID:ns:sub:id1@test
DTSTART:20260704T120000Z
SUMMARY:Uid With Colons
END:VEVENT`));
    const [event] = await getFeedEvents(WINDOW);
    expect(event._id).toBe('feed:custom-id1:2026-07-04T12:00:00.000Z:ns:sub:id1@test');
    expect(getFeedEventById(event._id)).toEqual(event);
  });

  it('keeps rendering other feeds when one fails', async () => {
    mockSubs.mockResolvedValue([
      { id: 'custom-bad1', feedUrl: 'https://example.com/bad.ics', mine: true },
      { id: 'custom-good1', feedUrl: 'https://example.com/good.ics', mine: true },
    ]);
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) =>
      url.includes('bad')
        ? Promise.resolve({ ok: false, status: 404 })
        : Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(
                ics(`
BEGIN:VEVENT
UID:good1@test
DTSTART:20260704T120000Z
SUMMARY:Still Here
END:VEVENT`)
              ),
          })
    );
    const events = await getFeedEvents(WINDOW);
    expect(events.map((e) => e.title)).toEqual(['Still Here']);
  });
});

describe('previewFeed', () => {
  it('surfaces X-WR-CALNAME, the event count, and upcoming samples', async () => {
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 86_400_000);
    const stamp = soon.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          ics(
            `
BEGIN:VEVENT
UID:p1@test
DTSTART:${stamp}
SUMMARY:Upcoming Thing
END:VEVENT`,
            'Family Stuff'
          )
        ),
    });
    const preview = await previewFeed('webcal://example.com/cal.ics');
    expect(preview.url).toBe('https://example.com/cal.ics');
    expect(preview.name).toBe('Family Stuff');
    expect(preview.eventCount).toBe(1);
    expect(preview.sample[0].title).toBe('Upcoming Thing');
  });

  it('throws typed errors for bad URL / HTTP failure / non-ICS body', async () => {
    await expect(previewFeed('not a url')).rejects.toMatchObject({ code: 'invalid_url' });

    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(previewFeed('https://example.com/x.ics')).rejects.toMatchObject({ code: 'fetch_failed' });

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body>not a calendar</body></html>'),
    });
    await expect(previewFeed('https://example.com/x.ics')).rejects.toMatchObject({ code: 'not_ics' });
  });
});
