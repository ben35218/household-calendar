jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Importing the module at all guards against module-scope evaluation errors
// (calendarPrefs computes ALL_HOLIDAY_IDS from lib/holidays at load time).
import { migrateLegacyEnabledList, holidayCalendarId, holidayEnabledIds } from '../calendarPrefs';
import { getAllHolidayIds } from '../holidays';

describe('migrateLegacyEnabledList', () => {
  it('returns null when there is no legacy data', () => {
    expect(migrateLegacyEnabledList(null)).toBeNull();
    expect(migrateLegacyEnabledList(undefined)).toBeNull();
    expect(migrateLegacyEnabledList('garbage')).toBeNull();
  });

  it('disables exactly the legacy ids missing from the enabled list', () => {
    const disabled = migrateLegacyEnabledList(['christmas-day', 'halloween'])!;
    expect(disabled).toContain('canada-day');
    expect(disabled).toContain('thanksgiving');
    expect(disabled).not.toContain('christmas-day');
    expect(disabled).not.toContain('halloween');
  });

  it('never disables ids added after the legacy era', () => {
    // A legacy user who turned everything off still gets the new countries'
    // holidays enabled by default.
    const disabled = new Set(migrateLegacyEnabledList([])!);
    for (const id of ['independence-day', 'mlk-day', 'australia-day', 'summer-bank-holiday']) {
      expect(disabled.has(id)).toBe(false);
    }
  });

  it('an untouched legacy user (everything enabled) migrates to nothing disabled', () => {
    const allLegacyEnabled = migrateLegacyEnabledList(getAllHolidayIds());
    expect(allLegacyEnabled).toEqual([]);
  });
});

describe('holiday calendar helpers', () => {
  const caCal = (over: Partial<{ selectedRegions: string[]; disabledIds: string[] }> = {}) => ({
    id: 'holiday-CA' as const,
    country: 'CA' as const,
    name: 'Canadian Holidays',
    color: '#D32F2F',
    selectedRegions: over.selectedRegions ?? [],
    disabledIds: over.disabledIds ?? [],
  });

  it('derives a stable calendar id per country', () => {
    expect(holidayCalendarId('CA')).toBe('holiday-CA');
    expect(holidayCalendarId('US')).toBe('holiday-US');
  });

  it('always includes national holidays and never bare regional ones', () => {
    const enabled = holidayEnabledIds(caCal());
    expect(enabled).toContain('canada-day'); // national — always on
    expect(enabled).toContain('christmas-day');
    expect(enabled).toContain('valentines-day'); // cultural — on by default
    expect(enabled).not.toContain('family-day-on'); // regional — needs its region
  });

  it('national holidays stay on even if listed as disabled', () => {
    const enabled = holidayEnabledIds(caCal({ disabledIds: ['canada-day'] }));
    expect(enabled).toContain('canada-day');
  });

  it('includes a region\'s holidays once the region is selected', () => {
    const enabled = holidayEnabledIds(caCal({ selectedRegions: ['Ontario'] }));
    expect(enabled).toContain('family-day-on');
    expect(enabled).not.toContain('louis-riel-day'); // Manitoba, not selected
  });

  it('opts cultural/religious holidays out via disabledIds', () => {
    const enabled = holidayEnabledIds(caCal({ disabledIds: ['valentines-day'] }));
    expect(enabled).not.toContain('valentines-day');
    expect(enabled).toContain('halloween');
  });
});
