import {
  getHolidays,
  getHolidayDefs,
  getAllHolidayIds,
  getCountryHolidayIds,
  holidayCalendarName,
  COUNTRIES,
  CountryCode,
} from '../holidays';

const year2026 = (country: CountryCode) => {
  const list = getHolidays(country, new Date(2026, 0, 1), new Date(2026, 11, 31));
  return Object.fromEntries(list.map((h) => [h.id, h.date]));
};

// The computed date of a single holiday id in a given Gregorian year.
const dateFor = (id: string, year: number): string | undefined =>
  getHolidays('CA', new Date(year, 0, 1), new Date(year, 11, 31), [id]).find((h) => h.id === id)?.date;

const daysApart = (a: string, b: string) =>
  Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000));

describe('getHolidays', () => {
  it('computes Canadian holidays for 2026', () => {
    const h = year2026('CA');
    expect(h['new-years-day']).toBe('2026-01-01');
    expect(h['good-friday']).toBe('2026-04-03');
    expect(h['easter-sunday']).toBe('2026-04-05');
    expect(h['victoria-day']).toBe('2026-05-25');
    expect(h['canada-day']).toBe('2026-07-01');
    expect(h['labour-day']).toBe('2026-09-07');
    expect(h['truth-reconciliation']).toBe('2026-09-30');
    expect(h['thanksgiving']).toBe('2026-10-12'); // 2nd Monday of October
    expect(h['remembrance-day']).toBe('2026-11-11');
    expect(h['boxing-day']).toBe('2026-12-26');
    expect(h['independence-day']).toBeUndefined();
  });

  it('computes US holidays for 2026', () => {
    const h = year2026('US');
    expect(h['mlk-day']).toBe('2026-01-19');
    expect(h['presidents-day']).toBe('2026-02-16');
    expect(h['memorial-day']).toBe('2026-05-25');
    expect(h['juneteenth']).toBe('2026-06-19');
    expect(h['independence-day']).toBe('2026-07-04');
    expect(h['labour-day']).toBe('2026-09-07');
    expect(h['veterans-day']).toBe('2026-11-11');
    expect(h['thanksgiving']).toBe('2026-11-26'); // 4th Thursday of November
    expect(h['canada-day']).toBeUndefined();
    expect(h['victoria-day']).toBeUndefined();
    expect(h['boxing-day']).toBeUndefined();
  });

  it('computes UK holidays for 2026, incl. Mothering Sunday', () => {
    const h = year2026('GB');
    expect(h['easter-monday']).toBe('2026-04-06');
    expect(h['early-may-bank-holiday']).toBe('2026-05-04');
    expect(h['spring-bank-holiday']).toBe('2026-05-25');
    expect(h['summer-bank-holiday']).toBe('2026-08-31');
    expect(h['mothers-day']).toBe('2026-03-15'); // three weeks before Easter
    expect(h['fathers-day']).toBe('2026-06-21');
  });

  it('computes Australian holidays for 2026, incl. September Father\'s Day', () => {
    const h = year2026('AU');
    expect(h['australia-day']).toBe('2026-01-26');
    expect(h['anzac-day']).toBe('2026-04-25');
    expect(h['kings-birthday']).toBe('2026-06-08');
    expect(h['mothers-day']).toBe('2026-05-10');
    expect(h['fathers-day']).toBe('2026-09-06');
  });

  it('observes Canada Day on July 2 when July 1 is a Sunday', () => {
    const h = getHolidays('CA', new Date(2029, 5, 1), new Date(2029, 6, 31));
    expect(h.find((x) => x.id === 'canada-day')?.date).toBe('2029-07-02');
  });

  it('filters by enabledIds', () => {
    const h = getHolidays('US', new Date(2026, 0, 1), new Date(2026, 11, 31), ['independence-day']);
    expect(h).toEqual([{ id: 'independence-day', name: 'Independence Day', date: '2026-07-04' }]);
  });

  it('respects the [from, to] range', () => {
    const h = getHolidays('CA', new Date(2026, 11, 20), new Date(2026, 11, 31));
    expect(h.map((x) => x.id).sort()).toEqual(['boxing-day', 'christmas-day']);
  });
});

describe('religious holidays (computed from their calendars)', () => {
  // Known observed dates, 2024–2030, to validate the calendrical/astronomical
  // rules that replaced the old finite lookup tables.
  const OBSERVED = {
    'hanukkah': { '2024': '2024-12-25', '2025': '2025-12-14', '2026': '2026-12-04', '2027': '2027-12-24', '2028': '2028-12-12', '2029': '2029-12-01', '2030': '2030-12-20' },
    'lunar-new-year': { '2024': '2024-02-10', '2025': '2025-01-29', '2026': '2026-02-17', '2027': '2027-02-06', '2028': '2028-01-26', '2029': '2029-02-13', '2030': '2030-02-03' },
    'diwali': { '2024': '2024-11-01', '2025': '2025-10-20', '2026': '2026-11-08', '2027': '2027-10-29', '2028': '2028-10-17', '2029': '2029-11-05', '2030': '2030-10-26' },
    'eid-al-fitr': { '2024': '2024-04-10', '2025': '2025-03-30', '2026': '2026-03-20', '2027': '2027-03-09', '2028': '2028-02-26', '2029': '2029-02-14', '2030': '2030-02-04' },
    'eid-al-adha': { '2024': '2024-06-17', '2025': '2025-06-06', '2026': '2026-05-27', '2027': '2027-05-16', '2028': '2028-05-05', '2029': '2029-04-24', '2030': '2030-04-13' },
  } as const;

  it('computes Hanukkah exactly from the Hebrew calendar', () => {
    for (const [year, date] of Object.entries(OBSERVED['hanukkah'])) {
      expect(dateFor('hanukkah', Number(year))).toBe(date);
    }
  });

  it('computes Lunar New Year exactly from the new moon', () => {
    for (const [year, date] of Object.entries(OBSERVED['lunar-new-year'])) {
      expect(dateFor('lunar-new-year', Number(year))).toBe(date);
    }
  });

  it('computes Diwali within a day of the observed amāvásyā', () => {
    for (const [year, date] of Object.entries(OBSERVED['diwali'])) {
      expect(daysApart(dateFor('diwali', Number(year))!, date)).toBeLessThanOrEqual(1);
    }
  });

  it('computes the Eids within two days (tabular vs. sighting)', () => {
    for (const key of ['eid-al-fitr', 'eid-al-adha'] as const) {
      for (const [year, date] of Object.entries(OBSERVED[key])) {
        expect(daysApart(dateFor(key, Number(year))!, date)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('still computes them beyond the old 2024–2035 table range', () => {
    for (const id of ['hanukkah', 'lunar-new-year', 'diwali', 'eid-al-fitr', 'eid-al-adha']) {
      const d = dateFor(id, 2045);
      expect(d).toMatch(/^2045-\d{2}-\d{2}$/);
    }
  });
});

describe('holiday defs', () => {
  it('every country has statutory, regional, cultural, and multicultural groups with unique ids', () => {
    for (const { code } of COUNTRIES) {
      const defs = getHolidayDefs(code);
      const ids = defs.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const group of ['statutory', 'regional', 'cultural', 'multicultural'] as const) {
        expect(defs.some((d) => d.group === group)).toBe(true);
      }
    }
  });

  it('regional holidays carry a subdivision name', () => {
    for (const { code } of COUNTRIES) {
      const regional = getHolidayDefs(code).filter((d) => d.group === 'regional');
      expect(regional.length).toBeGreaterThan(0);
      for (const d of regional) expect(typeof d.region).toBe('string');
    }
  });

  it('getCountryHolidayIds lists every id for a country', () => {
    const caIds = getCountryHolidayIds('CA');
    expect(caIds).toEqual(getHolidayDefs('CA').map((d) => d.id));
    expect(caIds).toContain('family-day-on'); // regional
    expect(caIds).toContain('canada-day'); // national
  });

  it('names a country calendar from its demonym', () => {
    expect(holidayCalendarName('CA')).toBe('Canadian Holidays');
    expect(holidayCalendarName('US')).toBe('US Holidays');
  });

  it('getAllHolidayIds is the union across countries', () => {
    const all = new Set(getAllHolidayIds());
    for (const { code } of COUNTRIES) {
      for (const d of getHolidayDefs(code)) expect(all.has(d.id)).toBe(true);
    }
    expect(all.has('canada-day')).toBe(true);
    expect(all.has('independence-day')).toBe(true);
  });
});
