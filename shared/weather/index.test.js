const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildForecast, isMowingDay, WMO_DESCRIPTIONS } = require('./index');

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
