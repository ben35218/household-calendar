const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildForecast, isMowingDay, WMO_DESCRIPTIONS, buildRangeRecords, buildOutlook, buildDailyClimate, placeCandidates } = require('./index');

test('isMowingDay: dry day is good, wet day is not', () => {
  assert.equal(isMowingDay(0, 10, 0), true);
  assert.equal(isMowingDay(5, 10, 0), false);   // too much precip today
  assert.equal(isMowingDay(0, 50, 0), false);   // high precip probability
  assert.equal(isMowingDay(0, 10, 20), false);  // ground still wet from yesterday
});

test('buildForecast maps open-meteo raw JSON to the view shape', () => {
  const raw = {
    daily_units: { temperature_2m_max: '°C', precipitation_sum: 'mm', wind_speed_10m_max: 'km/h' },
    daily: {
      time: ['2026-07-06', '2026-07-07'],
      weather_code: [0, 61],
      temperature_2m_max: [25, 22],
      temperature_2m_min: [14, 13],
      precipitation_sum: [0, 8],
      precipitation_probability_max: [5, 80],
      wind_speed_10m_max: [12, 20],
    },
    hourly: {
      time: ['2026-07-06T09:00', '2026-07-06T10:00', '2026-07-07T09:00'],
      temperature_2m: [18, 20, 15],
      precipitation_probability: [0, 5, 70],
      precipitation: [0, 0, 2],
      weather_code: [0, 1, 61],
    },
    current: {
      temperature_2m: 19, weather_code: 1, precipitation: 0,
      relative_humidity_2m: 55, wind_speed_10m: 10,
    },
  };

  const out = buildForecast(raw);
  assert.equal(out.forecast.length, 2);
  assert.equal(out.forecast[0].description, 'Clear sky');
  assert.equal(out.forecast[0].goodWeather, true);   // dry
  assert.equal(out.forecast[1].goodWeather, false);  // rainy
  assert.equal(out.forecast[0].hours.length, 2);     // two hourly rows on day 1
  assert.equal(out.current.temperature, 19);
  assert.equal(out.current.description, 'Mainly clear');
  assert.equal(out.units.temperature, '°C');
});

test('buildForecast tolerates a missing current block', () => {
  const out = buildForecast({
    daily: { time: ['2026-07-06'], weather_code: [0], temperature_2m_max: [25], temperature_2m_min: [14], precipitation_sum: [0], precipitation_probability_max: [5], wind_speed_10m_max: [12] },
  });
  assert.equal(out.current, null);
  assert.equal(out.forecast.length, 1);
});

test('WMO table has the common codes', () => {
  assert.equal(WMO_DESCRIPTIONS[0], 'Clear sky');
  assert.equal(WMO_DESCRIPTIONS[95], 'Thunderstorm');
});

test('buildRangeRecords merges archive + forecast, forecast wins overlaps, clipped to range', () => {
  const archiveRaw = {
    daily: {
      time: ['2026-07-04', '2026-07-05', '2026-07-06'],
      weather_code: [0, 61, 3],
      temperature_2m_max: [24, 20, 22],
      temperature_2m_min: [13, 12, 14],
      precipitation_sum: [0, 9, 1],
      wind_speed_10m_max: [10, 18, 12],
    },
  };
  const forecast = [
    { date: '2026-07-06', weatherCode: 1, description: 'Mainly clear', tempMax: 26, tempMin: 15, precipSum: 0, precipProbability: 5, windMax: 11, goodWeather: true, hours: [] },
    { date: '2026-07-07', weatherCode: 2, description: 'Partly cloudy', tempMax: 27, tempMin: 16, precipSum: 0, precipProbability: 10, windMax: 9, goodWeather: true, hours: [] },
  ];
  const recs = buildRangeRecords({ archiveRaw, forecast, from: '2026-07-05', to: '2026-07-07' });
  assert.deepEqual(recs.map((r) => r.date), ['2026-07-05', '2026-07-06', '2026-07-07']); // 07-04 clipped out
  assert.equal(recs[0].precipProbability, null);       // archive day (no prob)
  assert.equal(recs[1].weatherCode, 1);                // forecast won the 07-06 overlap
  assert.equal(recs[1].precipProbability, 5);
});

test('buildOutlook averages years into weeks', () => {
  const today = new Date('2026-07-06T12:00:00Z');
  const days = 14;
  // Two "years" of flat data: maxes 20 and 30 -> avg 25; precip 0 and 2 -> avg 1.
  const mk = (max, min, precip) => ({
    daily: {
      time: Array.from({ length: days }, (_, i) => `d${i}`),
      temperature_2m_max: Array(days).fill(max),
      temperature_2m_min: Array(days).fill(min),
      precipitation_sum: Array(days).fill(precip),
    },
  });
  const { weeks } = buildOutlook([mk(20, 10, 0), mk(30, 14, 2)], { today, days });
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].avgTempMax, 25);
  assert.equal(weeks[0].avgTempMin, 12);
  assert.equal(weeks[0].rainyDays, 7);           // avgPrecip 1 >= 1 on every day
  assert.equal(weeks[0].yearsInSample, 2);
});

test('buildDailyClimate averages per day across years, index-aligned', () => {
  const mk = (max, min, precip, len = 3) => ({
    daily: {
      time: Array.from({ length: len }, (_, i) => `d${i}`),
      temperature_2m_max: Array(len).fill(max),
      temperature_2m_min: Array(len).fill(min),
      precipitation_sum: Array(len).fill(precip),
    },
  });
  const dates = ['2026-08-01', '2026-08-02', '2026-08-03'];
  const days = buildDailyClimate([mk(20, 10, 0), mk(30, 14, 3)], { dates });
  assert.equal(days.length, 3);
  assert.equal(days[0].date, '2026-08-01');
  assert.equal(days[0].avgTempMax, 25);
  assert.equal(days[0].avgTempMin, 12);
  assert.equal(days[0].avgPrecip, 1.5);
  assert.equal(days[0].rainYears, 1);            // only the 3mm year counts as rainy
  assert.equal(days[0].yearsInSample, 2);

  // A year with a shorter archive is skipped past its length, not crashed on.
  const short = buildDailyClimate([mk(20, 10, 0, 1), mk(30, 14, 3)], { dates });
  assert.equal(short[2].avgTempMax, 30);
  assert.equal(short[2].yearsInSample, 1);
});

test('placeCandidates simplifies Google Places strings for Nominatim', () => {
  assert.deepEqual(
    placeCandidates('Florence, Metropolitan City of Florence, Italy'),
    ['Florence, Metropolitan City of Florence, Italy', 'Florence, Italy', 'Florence'],
  );
  assert.deepEqual(placeCandidates('Tokyo, Japan'), ['Tokyo, Japan', 'Tokyo']);
  assert.deepEqual(placeCandidates('Paris'), ['Paris']);
});
