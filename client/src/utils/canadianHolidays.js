import { format } from 'date-fns';

// Anonymous Gregorian algorithm for Easter Sunday
function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// nth occurrence of weekday (0=Sun) in a month (1-indexed)
function nthWeekday(year, month, weekday, nth) {
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) { if (++count === nth) return new Date(d); }
    d.setDate(d.getDate() + 1);
  }
}

// Last occurrence of a weekday on or before a given day-of-month
function lastWeekdayOnOrBefore(year, month, dayOfMonth, weekday) {
  const d = new Date(year, month - 1, dayOfMonth);
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return new Date(d);
}

// All available holiday definitions
export const HOLIDAY_DEFS = [
  // Statutory
  { id: 'new-years-day',        name: "New Year's Day",             group: 'statutory' },
  { id: 'good-friday',          name: 'Good Friday',                group: 'statutory' },
  { id: 'easter-sunday',        name: 'Easter Sunday',              group: 'statutory' },
  { id: 'victoria-day',         name: 'Victoria Day',               group: 'statutory' },
  { id: 'canada-day',           name: 'Canada Day',                 group: 'statutory' },
  { id: 'labour-day',           name: 'Labour Day',                 group: 'statutory' },
  { id: 'truth-reconciliation', name: 'Truth & Reconciliation Day', group: 'statutory' },
  { id: 'thanksgiving',         name: 'Thanksgiving',               group: 'statutory' },
  { id: 'remembrance-day',      name: 'Remembrance Day',            group: 'statutory' },
  { id: 'christmas-day',        name: 'Christmas Day',              group: 'statutory' },
  { id: 'boxing-day',           name: 'Boxing Day',                 group: 'statutory' },
  // Cultural
  { id: 'valentines-day',       name: "Valentine's Day",            group: 'cultural' },
  { id: 'st-patricks-day',      name: "St. Patrick's Day",          group: 'cultural' },
  { id: 'mothers-day',          name: "Mother's Day",               group: 'cultural' },
  { id: 'fathers-day',          name: "Father's Day",               group: 'cultural' },
  { id: 'halloween',            name: 'Halloween',                  group: 'cultural' },
  // Multicultural & Religious
  { id: 'lunar-new-year',       name: 'Lunar New Year',             group: 'multicultural' },
  { id: 'vaisakhi',             name: 'Vaisakhi',                   group: 'multicultural' },
  { id: 'diwali',               name: 'Diwali',                     group: 'multicultural' },
  { id: 'hanukkah',             name: 'Hanukkah',                   group: 'multicultural' },
  { id: 'eid-al-fitr',          name: 'Eid al-Fitr',               group: 'multicultural' },
  { id: 'eid-al-adha',          name: 'Eid al-Adha',               group: 'multicultural' },
];

const ALL_IDS    = new Set(HOLIDAY_DEFS.map(d => d.id));
const STATUTORY  = new Set(HOLIDAY_DEFS.filter(d => d.group === 'statutory').map(d => d.id));

// Lookup tables for holidays that require lunar/religious calendar computation.
// Islamic dates are approximate — actual observance depends on moon sighting.
const LUNAR_NEW_YEAR = {
  2024: '2024-02-10', 2025: '2025-01-29', 2026: '2026-02-17',
  2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13',
  2030: '2030-02-03', 2031: '2031-01-23', 2032: '2032-02-11',
  2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08',
};

const DIWALI = {
  2024: '2024-11-01', 2025: '2025-10-20', 2026: '2026-11-08',
  2027: '2027-10-29', 2028: '2028-10-17', 2029: '2029-11-05',
  2030: '2030-10-26', 2031: '2031-11-14', 2032: '2032-11-02',
  2033: '2033-10-22', 2034: '2034-11-10', 2035: '2035-10-30',
};

const HANUKKAH = {
  2024: '2024-12-25', 2025: '2025-12-14', 2026: '2026-12-04',
  2027: '2027-12-24', 2028: '2028-12-12', 2029: '2029-12-01',
  2030: '2030-12-20', 2031: '2031-12-09', 2032: '2032-11-27',
  2033: '2033-12-16', 2034: '2034-12-06', 2035: '2035-11-25',
};

const EID_AL_FITR = {
  2024: '2024-04-10', 2025: '2025-03-30', 2026: '2026-03-20',
  2027: '2027-03-09', 2028: '2028-02-26', 2029: '2029-02-14',
  2030: '2030-02-04', 2031: '2031-01-24', 2032: '2032-01-13',
  2033: '2033-01-02',
};

const EID_AL_ADHA = {
  2024: '2024-06-17', 2025: '2025-06-06', 2026: '2026-05-27',
  2027: '2027-05-16', 2028: '2028-05-05', 2029: '2029-04-24',
  2030: '2030-04-13', 2031: '2031-04-02', 2032: '2032-03-22',
  2033: '2033-03-11',
};

function getHolidaysForYear(year, enabledSet) {
  const list = [];

  function add(d, id) {
    if (!STATUTORY.has(id) && !enabledSet.has(id)) return;
    const def = HOLIDAY_DEFS.find(h => h.id === id);
    list.push({ date: format(d, 'yyyy-MM-dd'), name: def.name, id });
  }

  function addStr(dateStr, id) {
    if (!dateStr || (!STATUTORY.has(id) && !enabledSet.has(id))) return;
    const def = HOLIDAY_DEFS.find(h => h.id === id);
    list.push({ date: dateStr, name: def.name, id });
  }

  // Statutory
  add(new Date(year, 0, 1), 'new-years-day');

  const easter = easterDate(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(goodFriday.getDate() - 2);
  add(goodFriday, 'good-friday');
  add(easter, 'easter-sunday');

  add(lastWeekdayOnOrBefore(year, 5, 25, 1), 'victoria-day');

  const canadaDay = new Date(year, 6, 1);
  if (canadaDay.getDay() === 0) canadaDay.setDate(2);
  add(canadaDay, 'canada-day');

  add(nthWeekday(year, 9, 1, 1), 'labour-day');
  add(new Date(year, 8, 30), 'truth-reconciliation');
  add(nthWeekday(year, 10, 1, 2), 'thanksgiving');
  add(new Date(year, 10, 11), 'remembrance-day');
  add(new Date(year, 11, 25), 'christmas-day');
  add(new Date(year, 11, 26), 'boxing-day');

  // Cultural
  add(new Date(year, 1, 14), 'valentines-day');
  add(new Date(year, 2, 17), 'st-patricks-day');
  add(nthWeekday(year, 5, 0, 2), 'mothers-day');  // 2nd Sunday in May
  add(nthWeekday(year, 6, 0, 3), 'fathers-day');  // 3rd Sunday in June
  add(new Date(year, 9, 31), 'halloween');

  // Multicultural
  addStr(LUNAR_NEW_YEAR[year], 'lunar-new-year');
  add(new Date(year, 3, 13), 'vaisakhi');         // April 13 (±1 day)
  addStr(DIWALI[year], 'diwali');
  addStr(HANUKKAH[year], 'hanukkah');
  addStr(EID_AL_FITR[year], 'eid-al-fitr');
  addStr(EID_AL_ADHA[year], 'eid-al-adha');

  return list;
}

// Returns holidays whose date falls within [fromDate, toDate].
// enabledIds: array of holiday IDs to include; defaults to all.
export function getCanadianHolidays(fromDate, toDate, enabledIds = null) {
  const enabledSet = enabledIds ? new Set(enabledIds) : ALL_IDS;
  const fromStr = format(fromDate, 'yyyy-MM-dd');
  const toStr   = format(toDate,   'yyyy-MM-dd');
  const years   = [];
  for (let y = fromDate.getFullYear(); y <= toDate.getFullYear(); y++) years.push(y);
  return years
    .flatMap(y => getHolidaysForYear(y, enabledSet))
    .filter(h => h.date >= fromStr && h.date <= toStr);
}
