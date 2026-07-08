import { zonedWallclockToUtc, zonedParts, zonedTimeLabel } from '../tz';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

describe('zonedWallclockToUtc', () => {
  it('returns null without a date', () => {
    expect(zonedWallclockToUtc('', '12:00', NY)).toBeNull();
  });

  it('converts an EST wall-clock to the right instant (UTC-5)', () => {
    const utc = zonedWallclockToUtc('2026-01-15', '12:00', NY)!;
    expect(utc.toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('converts an EDT wall-clock to the right instant (UTC-4)', () => {
    const utc = zonedWallclockToUtc('2026-07-15', '12:00', NY)!;
    expect(utc.toISOString()).toBe('2026-07-15T16:00:00.000Z');
  });

  it('handles zones ahead of UTC', () => {
    const utc = zonedWallclockToUtc('2026-07-15', '09:00', TOKYO)!;
    expect(utc.toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });

  it('defaults to midnight when no time is given', () => {
    const utc = zonedWallclockToUtc('2026-01-15', '', TOKYO)!;
    expect(utc.toISOString()).toBe('2026-01-14T15:00:00.000Z');
  });

  it('converges just after the spring-forward gap', () => {
    // 03:00 EDT on the DST transition day (02:00-03:00 does not exist).
    const utc = zonedWallclockToUtc('2026-03-08', '03:00', NY)!;
    expect(utc.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('falls back to device-local parsing without a tz', () => {
    const utc = zonedWallclockToUtc('2026-01-15', '12:00')!;
    expect(utc.getTime()).toBe(new Date('2026-01-15T12:00:00').getTime());
  });
});

describe('zonedParts', () => {
  it('renders a UTC instant as wall-clock parts in the zone', () => {
    expect(zonedParts('2026-01-15T17:00:00.000Z', NY)).toEqual({
      dateStr: '2026-01-15',
      timeStr: '12:00',
      minutes: 12 * 60,
    });
  });

  it('crosses the date line correctly', () => {
    expect(zonedParts('2026-07-15T20:00:00.000Z', TOKYO)).toEqual({
      dateStr: '2026-07-16',
      timeStr: '05:00',
      minutes: 5 * 60,
    });
  });

  it('round-trips with zonedWallclockToUtc across DST boundaries', () => {
    for (const [dateStr, timeStr] of [
      ['2026-03-07', '18:30'], // day before spring forward
      ['2026-03-09', '02:30'], // day after
      ['2026-11-01', '13:15'], // fall-back day, after the transition
    ] as const) {
      const utc = zonedWallclockToUtc(dateStr, timeStr, NY)!;
      const parts = zonedParts(utc, NY);
      expect(parts).toMatchObject({ dateStr, timeStr });
    }
  });

  it('uses device-local wall clock when tz is missing', () => {
    const d = new Date(2026, 0, 15, 9, 5);
    expect(zonedParts(d)).toEqual({
      dateStr: '2026-01-15',
      timeStr: '09:05',
      minutes: 9 * 60 + 5,
    });
  });
});

describe('zonedTimeLabel', () => {
  it('includes the time and zone abbreviation', () => {
    expect(zonedTimeLabel('2026-07-15T22:00:00.000Z', NY)).toBe('6:00 PM EDT');
    expect(zonedTimeLabel('2026-01-15T23:00:00.000Z', NY)).toBe('6:00 PM EST');
  });

  it('omits the abbreviation without a tz', () => {
    expect(zonedTimeLabel(new Date(2026, 0, 15, 18, 0))).toBe('6:00 PM');
  });
});
