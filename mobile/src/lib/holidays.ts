// Country-aware holiday engine (originally ported from the web client's
// canadianHolidays.js, Canada-only). Pure date math (no date-fns) so it runs
// under Hermes. Powers the Holidays settings screen, the Events list, and the
// calendar holiday dots.
//
// Statutory (national) and regional (provincial/state) holidays are per-country;
// cultural holidays also vary where countries differ (UK Mothering Sunday,
// Australian Father's Day). The multicultural/religious set is shared. To add a
// country: add its code to CountryCode/COUNTRIES and its STATUTORY + REGIONAL +
// CULTURAL lists (and REGIONS subdivisions) below.

export type CountryCode = 'CA' | 'US' | 'GB' | 'AU';

export interface CountryDef {
  code: CountryCode;
  name: string;
  // Demonym used to name a country's holiday calendar ("Canadian Holidays").
  adjective: string;
}

export const COUNTRIES: CountryDef[] = [
  { code: 'CA', name: 'Canada', adjective: 'Canadian' },
  { code: 'US', name: 'United States', adjective: 'US' },
  { code: 'GB', name: 'United Kingdom', adjective: 'UK' },
  { code: 'AU', name: 'Australia', adjective: 'Australian' },
];

export const DEFAULT_COUNTRY: CountryCode = 'US';

// Display name for a country's holiday calendar row/screen.
export function holidayCalendarName(country: CountryCode): string {
  const def = COUNTRIES.find((c) => c.code === country);
  return def ? `${def.adjective} Holidays` : 'Holidays';
}

// Section title for a country's sub-national holidays, using its own terminology
// (provinces, states, territories, or UK nations).
export function regionalHolidaysLabel(country: CountryCode): string {
  switch (country) {
    case 'CA':
      return 'Provincial & Territorial Holidays';
    case 'US':
      return 'State Holidays';
    case 'GB':
      return 'Regional Holidays';
    case 'AU':
      return 'State & Territory Holidays';
  }
}

// Provinces / states / nations whose regional holidays a country's calendar
// includes. Only subdivisions that actually carry a REGIONAL rule below are
// listed; the settings screen groups regional holidays under these names.
export interface RegionDef {
  code: string;
  name: string;
}

export const REGIONS: Record<CountryCode, RegionDef[]> = {
  CA: [
    { code: 'AB', name: 'Alberta' },
    { code: 'BC', name: 'British Columbia' },
    { code: 'MB', name: 'Manitoba' },
    { code: 'NB', name: 'New Brunswick' },
    { code: 'NL', name: 'Newfoundland & Labrador' },
    { code: 'NS', name: 'Nova Scotia' },
    { code: 'ON', name: 'Ontario' },
    { code: 'PE', name: 'Prince Edward Island' },
    { code: 'QC', name: 'Quebec' },
    { code: 'SK', name: 'Saskatchewan' },
    { code: 'NT', name: 'Northwest Territories' },
    { code: 'NU', name: 'Nunavut' },
    { code: 'YT', name: 'Yukon' },
  ],
  US: [
    { code: 'CA', name: 'California' },
    { code: 'DC', name: 'District of Columbia' },
    { code: 'HI', name: 'Hawaii' },
    { code: 'LA', name: 'Louisiana' },
    { code: 'MA', name: 'Massachusetts' },
    { code: 'ME', name: 'Maine' },
    { code: 'MO', name: 'Missouri' },
    { code: 'NV', name: 'Nevada' },
    { code: 'TX', name: 'Texas' },
    { code: 'UT', name: 'Utah' },
  ],
  GB: [
    { code: 'ENG', name: 'England' },
    { code: 'SCT', name: 'Scotland' },
    { code: 'WLS', name: 'Wales' },
    { code: 'NIR', name: 'Northern Ireland' },
  ],
  AU: [
    { code: 'ACT', name: 'Australian Capital Territory' },
    { code: 'NSW', name: 'New South Wales' },
    { code: 'NT', name: 'Northern Territory' },
    { code: 'QLD', name: 'Queensland' },
    { code: 'SA', name: 'South Australia' },
    { code: 'TAS', name: 'Tasmania' },
    { code: 'VIC', name: 'Victoria' },
    { code: 'WA', name: 'Western Australia' },
  ],
};

export interface HolidayDef {
  id: string;
  name: string;
  group: 'statutory' | 'regional' | 'cultural' | 'multicultural';
  // Subdivision name for group 'regional' (e.g. "Ontario"); undefined otherwise.
  region?: string;
}

export interface Holiday {
  date: string;
  name: string;
  id: string;
}

// ── Date helpers ────────────────────────────────────────────────────────────

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function easterDate(year: number): Date {
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
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) {
      if (++count === nth) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
}

function lastWeekdayOnOrBefore(year: number, month: number, dayOfMonth: number, weekday: number): Date {
  const d = new Date(year, month - 1, dayOfMonth);
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return new Date(d);
}

// ── Calendar engines for religious holidays ─────────────────────────────────
// The lunar/lunisolar festivals follow their own calendars, not a Gregorian
// day-of-year, so we compute each from its actual rule (valid for any year)
// rather than a finite lookup table. All work in Rata Die (RD 1 = 0001-01-01,
// proleptic Gregorian; RD 719163 = 1970-01-01) and emit yyyy-MM-dd.

const RD_UNIX = 719163;
const rmod = (x: number, y: number) => ((x % y) + y) % y;
const rdToFmt = (rd: number): string => {
  const d = new Date((rd - RD_UNIX) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const gregorianToRd = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + RD_UNIX;

// Hebrew (arithmetic) calendar — enough of it to place Hanukkah (25 Kislev).
// Months: Nisan 1 … Tishri 7, Marheshvan 8, Kislev 9 … (leap: Adar II 13).
const HEBREW_EPOCH = -1373427;
const hebrewLeap = (y: number) => rmod(7 * y + 1, 19) < 7;
const hebrewLastMonth = (y: number) => (hebrewLeap(y) ? 13 : 12);
function hebrewElapsedDays(y: number): number {
  const monthsElapsed = Math.floor((235 * y - 234) / 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  let day = monthsElapsed * 29 + Math.floor(partsElapsed / 25920);
  if (rmod(3 * (day + 1), 7) < 3) day += 1;
  return day;
}
function hebrewNewYear(y: number): number {
  const prev = hebrewElapsedDays(y - 1);
  const curr = hebrewElapsedDays(y);
  const next = hebrewElapsedDays(y + 1);
  const delay = next - curr === 356 ? 2 : curr - prev === 382 ? 1 : 0;
  return HEBREW_EPOCH + curr + delay;
}
const hebrewYearLength = (y: number) => hebrewNewYear(y + 1) - hebrewNewYear(y);
function hebrewLastDayOfMonth(y: number, m: number): number {
  if (m === 2 || m === 4 || m === 6 || m === 10 || m === 13) return 29;
  if (m === 12 && !hebrewLeap(y)) return 29;
  if (m === 8 && ![355, 385].includes(hebrewYearLength(y))) return 29; // Marheshvan
  if (m === 9 && [353, 383].includes(hebrewYearLength(y))) return 29; // Kislev
  return 30;
}
function hebrewToRd(y: number, month: number, day: number): number {
  let rd = hebrewNewYear(y) + day - 1;
  if (month < 7) {
    for (let m = 7; m <= hebrewLastMonth(y); m++) rd += hebrewLastDayOfMonth(y, m);
    for (let m = 1; m < month; m++) rd += hebrewLastDayOfMonth(y, m);
  } else {
    for (let m = 7; m < month; m++) rd += hebrewLastDayOfMonth(y, m);
  }
  return rd;
}
// Hanukkah's first night — when the first candle is lit — begins at sunset as
// 25 Kislev starts, i.e. the civil evening before 25 Kislev's daytime, so step
// back one day from the fixed date. The Hebrew year is the Gregorian year + 3761.
const hanukkahDate: DateRule = (y) => rdToFmt(hebrewToRd(y + 3761, 9, 25) - 1);

// Tabular (arithmetic) Islamic calendar — the civil rule; observed Eids can
// differ by a day with the moon sighting, hence the "approx." flag in the UI.
const ISLAMIC_EPOCH = 227015;
const islamicToRd = (y: number, m: number, d: number) =>
  d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + ISLAMIC_EPOCH - 1;
// The Islamic date (month/day) that falls within Gregorian year `gy`. The
// Islamic year drifts ~11 days/year, so search the candidate years around it.
function islamicInGregorian(gy: number, month: number, day: number): string | undefined {
  const approx = Math.floor((gy - 622) * (33 / 32)) + 1;
  for (let iy = approx - 2; iy <= approx + 2; iy++) {
    const iso = rdToFmt(islamicToRd(iy, month, day));
    if (Number(iso.slice(0, 4)) === gy) return iso;
  }
  return undefined;
}
const eidAlFitrDate: DateRule = (y) => islamicInGregorian(y, 10, 1); // 1 Shawwal
const eidAlAdhaDate: DateRule = (y) => islamicInGregorian(y, 12, 10); // 10 Dhu al-Hijjah

// Astronomical new moon (Meeus, Astronomical Algorithms ch. 49), good to well
// under a day for modern years — enough to date the lunisolar festivals.
const sinDeg = (x: number) => Math.sin((x * Math.PI) / 180);
function newMoonJde(k: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3; // Sun mean anomaly
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4; // Moon
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;
  jde +=
    -0.4072 * sinDeg(Mp) +
    0.17241 * E * sinDeg(M) +
    0.01608 * sinDeg(2 * Mp) +
    0.01039 * sinDeg(2 * F) +
    0.00739 * E * sinDeg(Mp - M) +
    -0.00514 * E * sinDeg(Mp + M) +
    0.00208 * E * E * sinDeg(2 * M) +
    -0.00111 * sinDeg(Mp - 2 * F) +
    -0.00057 * sinDeg(Mp + 2 * F) +
    0.00056 * E * sinDeg(2 * Mp + M) +
    -0.00042 * sinDeg(3 * Mp) +
    0.00042 * E * sinDeg(M + 2 * F) +
    0.00038 * E * sinDeg(M - 2 * F) +
    -0.00024 * E * sinDeg(2 * Mp - M) +
    -0.00017 * sinDeg(O) +
    -0.00007 * sinDeg(Mp + 2 * M) +
    0.00004 * sinDeg(2 * Mp - 2 * F) +
    0.00004 * sinDeg(3 * M) +
    0.00003 * sinDeg(Mp + M - 2 * F) +
    0.00003 * sinDeg(2 * Mp + 2 * F) +
    -0.00003 * sinDeg(Mp + M + 2 * F) +
    0.00003 * sinDeg(Mp - M + 2 * F) +
    -0.00002 * sinDeg(Mp - M - 2 * F) +
    -0.00002 * sinDeg(3 * Mp + M) +
    0.00002 * sinDeg(4 * Mp);
  // Largest planetary correction (sub-minute terms omitted).
  const A1 = 299.77 + 0.107408 * k - 0.009173 * T2;
  jde += 0.000325 * sinDeg(A1);
  return jde;
}
// The calendar date (in the festival's home timezone) of the new moon that
// falls in [start, end]. tzHours localizes the instant so the date matches
// where the festival is reckoned (China +8, India +5:30).
function newMoonInWindow(start: number, end: number, tzHours: number): string | undefined {
  const midYear = 1970 + (start - RD_UNIX + (end - start) / 2) / 365.25;
  const kEst = Math.round((midYear - 2000) * 12.3685);
  for (let k = kEst - 2; k <= kEst + 2; k++) {
    const rd = Math.floor(newMoonJde(k) - 1721424.5 + tzHours / 24);
    if (rd >= start && rd <= end) return rdToFmt(rd);
  }
  return undefined;
}
// Chinese New Year: the new moon that falls between Jan 21 and Feb 20 (the 2nd
// new moon after the winter solstice), reckoned in China (UTC+8).
const lunarNewYearDate: DateRule = (y) => newMoonInWindow(gregorianToRd(y, 1, 21), gregorianToRd(y, 2, 20), 8);
// Diwali (Lakshmi Puja): the Kartik amāvásyā (new moon), reckoned in India
// (UTC+5:30); it always falls in the mid-Oct .. mid-Nov window.
const diwaliDate: DateRule = (y) => newMoonInWindow(gregorianToRd(y, 10, 15), gregorianToRd(y, 11, 14), 5.5);

// ── Rule combinators ────────────────────────────────────────────────────────

type DateRule = (year: number) => string | undefined;

interface HolidayRule extends HolidayDef {
  date: DateRule;
}

const fixed = (month: number, day: number): DateRule => (y) => fmt(new Date(y, month - 1, day));
const nth = (month: number, weekday: number, n: number): DateRule => (y) => fmt(nthWeekday(y, month, weekday, n));
const lastOnOrBefore = (month: number, dayOfMonth: number, weekday: number): DateRule => (y) =>
  fmt(lastWeekdayOnOrBefore(y, month, dayOfMonth, weekday));
const easterOffset = (days: number): DateRule => (y) => {
  const d = easterDate(y);
  d.setDate(d.getDate() + days);
  return fmt(d);
};

const rule = (
  id: string,
  name: string,
  group: HolidayDef['group'],
  date: DateRule,
  region?: string
): HolidayRule => ({
  id,
  name,
  group,
  date,
  region,
});

// A regional (provincial/state) holiday, tagged with its subdivision name so
// the settings screen can group it under a region heading.
const regional = (id: string, name: string, region: string, date: DateRule): HolidayRule =>
  rule(id, name, 'regional', date, region);

// ── Shared rules ────────────────────────────────────────────────────────────

const NEW_YEARS = rule('new-years-day', "New Year's Day", 'statutory', fixed(1, 1));
const GOOD_FRIDAY = rule('good-friday', 'Good Friday', 'statutory', easterOffset(-2));
const EASTER_MONDAY = rule('easter-monday', 'Easter Monday', 'statutory', easterOffset(1));
const CHRISTMAS = rule('christmas-day', 'Christmas Day', 'statutory', fixed(12, 25));
const BOXING_DAY = rule('boxing-day', 'Boxing Day', 'statutory', fixed(12, 26));

const VALENTINES = rule('valentines-day', "Valentine's Day", 'cultural', fixed(2, 14));
const ST_PATRICKS = rule('st-patricks-day', "St. Patrick's Day", 'cultural', fixed(3, 17));
const HALLOWEEN = rule('halloween', 'Halloween', 'cultural', fixed(10, 31));
const EASTER_CULTURAL = rule('easter-sunday', 'Easter Sunday', 'cultural', easterOffset(0));
const MOTHERS_MAY = rule('mothers-day', "Mother's Day", 'cultural', nth(5, 0, 2));
const FATHERS_JUNE = rule('fathers-day', "Father's Day", 'cultural', nth(6, 0, 3));

// Observed July 2 when July 1 falls on a Sunday (matches the original port).
const canadaDay: DateRule = (y) => {
  const d = new Date(y, 6, 1);
  if (d.getDay() === 0) d.setDate(2);
  return fmt(d);
};

// ── Per-country holiday sets ────────────────────────────────────────────────

const STATUTORY: Record<CountryCode, HolidayRule[]> = {
  CA: [
    NEW_YEARS,
    GOOD_FRIDAY,
    rule('easter-sunday', 'Easter Sunday', 'statutory', easterOffset(0)),
    rule('victoria-day', 'Victoria Day', 'statutory', lastOnOrBefore(5, 25, 1)),
    rule('canada-day', 'Canada Day', 'statutory', canadaDay),
    rule('labour-day', 'Labour Day', 'statutory', nth(9, 1, 1)),
    rule('truth-reconciliation', 'Truth & Reconciliation Day', 'statutory', fixed(9, 30)),
    rule('thanksgiving', 'Thanksgiving', 'statutory', nth(10, 1, 2)),
    rule('remembrance-day', 'Remembrance Day', 'statutory', fixed(11, 11)),
    CHRISTMAS,
    BOXING_DAY,
  ],
  US: [
    NEW_YEARS,
    rule('mlk-day', 'Martin Luther King Jr. Day', 'statutory', nth(1, 1, 3)),
    rule('presidents-day', "Presidents' Day", 'statutory', nth(2, 1, 3)),
    rule('memorial-day', 'Memorial Day', 'statutory', lastOnOrBefore(5, 31, 1)),
    rule('juneteenth', 'Juneteenth', 'statutory', fixed(6, 19)),
    rule('independence-day', 'Independence Day', 'statutory', fixed(7, 4)),
    rule('labour-day', 'Labor Day', 'statutory', nth(9, 1, 1)),
    rule('indigenous-peoples-day', "Indigenous Peoples' Day", 'statutory', nth(10, 1, 2)),
    rule('veterans-day', 'Veterans Day', 'statutory', fixed(11, 11)),
    rule('thanksgiving', 'Thanksgiving', 'statutory', nth(11, 4, 4)),
    CHRISTMAS,
  ],
  GB: [
    NEW_YEARS,
    GOOD_FRIDAY,
    EASTER_MONDAY,
    rule('early-may-bank-holiday', 'Early May Bank Holiday', 'statutory', nth(5, 1, 1)),
    rule('spring-bank-holiday', 'Spring Bank Holiday', 'statutory', lastOnOrBefore(5, 31, 1)),
    rule('summer-bank-holiday', 'Summer Bank Holiday', 'statutory', lastOnOrBefore(8, 31, 1)),
    CHRISTMAS,
    BOXING_DAY,
  ],
  AU: [
    NEW_YEARS,
    rule('australia-day', 'Australia Day', 'statutory', fixed(1, 26)),
    GOOD_FRIDAY,
    EASTER_MONDAY,
    rule('anzac-day', 'Anzac Day', 'statutory', fixed(4, 25)),
    rule('kings-birthday', "King's Birthday", 'statutory', nth(6, 1, 2)),
    CHRISTMAS,
    BOXING_DAY,
  ],
};

const CULTURAL: Record<CountryCode, HolidayRule[]> = {
  CA: [VALENTINES, ST_PATRICKS, MOTHERS_MAY, FATHERS_JUNE, HALLOWEEN],
  US: [
    VALENTINES,
    ST_PATRICKS,
    rule('good-friday', 'Good Friday', 'cultural', easterOffset(-2)),
    EASTER_CULTURAL,
    MOTHERS_MAY,
    FATHERS_JUNE,
    HALLOWEEN,
  ],
  GB: [
    VALENTINES,
    ST_PATRICKS,
    // Mothering Sunday: fourth Sunday of Lent, three weeks before Easter.
    rule('mothers-day', "Mother's Day", 'cultural', easterOffset(-21)),
    EASTER_CULTURAL,
    FATHERS_JUNE,
    HALLOWEEN,
    rule('bonfire-night', 'Bonfire Night', 'cultural', fixed(11, 5)),
    rule('remembrance-day', 'Remembrance Day', 'cultural', fixed(11, 11)),
  ],
  AU: [VALENTINES, ST_PATRICKS, EASTER_CULTURAL, MOTHERS_MAY, HALLOWEEN,
    rule('fathers-day', "Father's Day", 'cultural', nth(9, 0, 1)),
  ],
};

// ── Per-country regional (provincial/state) holiday sets ────────────────────
// A curated, representative set of each subdivision's notable holidays — not an
// exhaustive legal listing. Extend by adding more `regional(...)` entries.
const REGIONAL: Record<CountryCode, HolidayRule[]> = {
  CA: [
    regional('family-day-on', 'Family Day', 'Ontario', nth(2, 1, 3)),
    regional('family-day-ab', 'Family Day', 'Alberta', nth(2, 1, 3)),
    regional('family-day-bc', 'Family Day', 'British Columbia', nth(2, 1, 3)),
    regional('family-day-sk', 'Family Day', 'Saskatchewan', nth(2, 1, 3)),
    regional('family-day-nb', 'Family Day', 'New Brunswick', nth(2, 1, 3)),
    regional('louis-riel-day', 'Louis Riel Day', 'Manitoba', nth(2, 1, 3)),
    regional('islander-day', 'Islander Day', 'Prince Edward Island', nth(2, 1, 3)),
    regional('ns-heritage-day', 'Nova Scotia Heritage Day', 'Nova Scotia', nth(2, 1, 3)),
    regional('fete-nationale', 'Fête nationale du Québec', 'Quebec', fixed(6, 24)),
    regional('civic-holiday-on', 'Civic Holiday', 'Ontario', nth(8, 1, 1)),
    regional('saskatchewan-day', 'Saskatchewan Day', 'Saskatchewan', nth(8, 1, 1)),
    regional('natal-day-ns', 'Natal Day', 'Nova Scotia', nth(8, 1, 1)),
    regional('nb-day', 'New Brunswick Day', 'New Brunswick', nth(8, 1, 1)),
    regional('bc-day', 'British Columbia Day', 'British Columbia', nth(8, 1, 1)),
    regional('heritage-day-ab', 'Heritage Day', 'Alberta', nth(8, 1, 1)),
    regional('nunavut-day', 'Nunavut Day', 'Nunavut', fixed(7, 9)),
    regional('discovery-day-yt', 'Discovery Day', 'Yukon', nth(8, 1, 3)),
    regional('orangemens-day', "Orangemen's Day", 'Newfoundland & Labrador', fixed(7, 12)),
    regional('nwt-indigenous-day', 'National Indigenous Peoples Day', 'Northwest Territories', fixed(6, 21)),
  ],
  US: [
    regional('patriots-day', "Patriots' Day", 'Massachusetts', nth(4, 1, 3)),
    regional('patriots-day-me', "Patriots' Day", 'Maine', nth(4, 1, 3)),
    regional('emancipation-day-dc', 'Emancipation Day', 'District of Columbia', fixed(4, 16)),
    regional('cesar-chavez-day', 'César Chávez Day', 'California', fixed(3, 31)),
    regional('pioneer-day', 'Pioneer Day', 'Utah', fixed(7, 24)),
    regional('mardi-gras', 'Mardi Gras', 'Louisiana', easterOffset(-47)),
    regional('nevada-day', 'Nevada Day', 'Nevada', lastOnOrBefore(10, 31, 5)),
    regional('truman-day', 'Truman Day', 'Missouri', fixed(5, 8)),
    regional('statehood-day-hi', 'Statehood Day', 'Hawaii', nth(8, 5, 3)),
    regional('texas-independence-day', 'Texas Independence Day', 'Texas', fixed(3, 2)),
  ],
  GB: [
    regional('scotland-2-jan', '2 January', 'Scotland', fixed(1, 2)),
    regional('st-andrews-day', "St Andrew's Day", 'Scotland', fixed(11, 30)),
    regional('st-davids-day', "St David's Day", 'Wales', fixed(3, 1)),
    regional('st-georges-day', "St George's Day", 'England', fixed(4, 23)),
    regional('battle-of-the-boyne', 'Battle of the Boyne', 'Northern Ireland', fixed(7, 12)),
    regional('st-patricks-day-ni', "St Patrick's Day", 'Northern Ireland', fixed(3, 17)),
  ],
  AU: [
    regional('canberra-day', 'Canberra Day', 'Australian Capital Territory', nth(3, 1, 2)),
    regional('labour-day-nsw', 'Labour Day', 'New South Wales', nth(10, 1, 1)),
    regional('picnic-day', 'Picnic Day', 'Northern Territory', nth(8, 1, 1)),
    regional('labour-day-qld', 'Labour Day', 'Queensland', nth(5, 1, 1)),
    regional('adelaide-cup', 'Adelaide Cup', 'South Australia', nth(3, 1, 2)),
    regional('eight-hours-day', 'Eight Hours Day', 'Tasmania', nth(3, 1, 2)),
    regional('labour-day-vic', 'Labour Day', 'Victoria', nth(3, 1, 2)),
    regional('melbourne-cup', 'Melbourne Cup', 'Victoria', nth(11, 2, 1)),
    regional('western-australia-day', 'Western Australia Day', 'Western Australia', nth(6, 1, 1)),
  ],
};

const MULTICULTURAL: HolidayRule[] = [
  rule('lunar-new-year', 'Lunar New Year', 'multicultural', lunarNewYearDate),
  // Vaisakhi is fixed to 14 April by the Nanakshahi calendar (a solar reckoning).
  rule('vaisakhi', 'Vaisakhi', 'multicultural', fixed(4, 14)),
  rule('diwali', 'Diwali', 'multicultural', diwaliDate),
  rule('hanukkah', 'Hanukkah', 'multicultural', hanukkahDate),
  rule('eid-al-fitr', 'Eid al-Fitr', 'multicultural', eidAlFitrDate),
  rule('eid-al-adha', 'Eid al-Adha', 'multicultural', eidAlAdhaDate),
];

function rulesFor(country: CountryCode): HolidayRule[] {
  return [...STATUTORY[country], ...REGIONAL[country], ...CULTURAL[country], ...MULTICULTURAL];
}

// ── Public API ──────────────────────────────────────────────────────────────

// Definitions for the Holidays settings screen, in display order.
export function getHolidayDefs(country: CountryCode): HolidayDef[] {
  return rulesFor(country).map(({ id, name, group, region }) => ({ id, name, group, region }));
}

// Every holiday id for one country (national + regional + cultural + religious),
// in display order — used to turn a calendar's disabled-list into an enabled-list.
export function getCountryHolidayIds(country: CountryCode): string[] {
  return rulesFor(country).map((r) => r.id);
}

// Union of every holiday id across all countries (for prefs storage).
export function getAllHolidayIds(): string[] {
  const ids = new Set<string>();
  for (const c of COUNTRIES) for (const r of rulesFor(c.code)) ids.add(r.id);
  return [...ids];
}

// Returns holidays for the given country whose date falls within
// [fromDate, toDate]. enabledIds of null means "all enabled".
export function getHolidays(
  country: CountryCode,
  fromDate: Date,
  toDate: Date,
  enabledIds: string[] | null = null
): Holiday[] {
  const rules = rulesFor(country);
  const enabledSet = enabledIds ? new Set(enabledIds) : null;
  const fromStr = fmt(fromDate);
  const toStr = fmt(toDate);
  const out: Holiday[] = [];
  for (let y = fromDate.getFullYear(); y <= toDate.getFullYear(); y++) {
    for (const r of rules) {
      if (enabledSet && !enabledSet.has(r.id)) continue;
      const date = r.date(y);
      if (date && date >= fromStr && date <= toStr) out.push({ date, name: r.name, id: r.id });
    }
  }
  return out;
}
