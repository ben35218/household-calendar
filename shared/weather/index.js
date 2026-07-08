// Shared client weather engine (§9.1 P5b).
//
// Pure `buildForecast` + thin open-meteo fetch helpers (keyless + CORS-open, so
// web and mobile can call them directly from the decrypted home coordinates —
// no server, no API key). Mirrors the shape server/services/weather.js returned
// so the weather views render unchanged. Uses the platform global `fetch`
// (browser / React Native / Node 18+).

const WMO_DESCRIPTIONS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Moderate showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Heavy thunderstorm with hail',
};

function isMowingDay(precipSum, precipProb, prevPrecipSum) {
  return (
    (precipProb ?? 0) < 35 &&
    (precipSum ?? 0) < 3 &&
    (prevPrecipSum ?? 0) < 15
  );
}

// Pure: raw open-meteo forecast JSON -> { current, forecast, units }.
function buildForecast(raw) {
  const { daily, current, hourly, daily_units } = raw;

  const hourlyByDate = {};
  if (hourly) {
    hourly.time.forEach((iso, i) => {
      const date = iso.slice(0, 10);
      if (!hourlyByDate[date]) hourlyByDate[date] = [];
      hourlyByDate[date].push({
        time: iso,
        hour: parseInt(iso.slice(11, 13), 10),
        temperature: hourly.temperature_2m[i],
        precipProbability: hourly.precipitation_probability[i],
        precipitation: hourly.precipitation[i],
        weatherCode: hourly.weather_code[i],
        description: WMO_DESCRIPTIONS[hourly.weather_code[i]] ?? 'Unknown',
      });
    });
  }

  const forecast = daily.time.map((date, i) => {
    const prevPrecip = i > 0 ? daily.precipitation_sum[i - 1] : 0;
    return {
      date,
      weatherCode: daily.weather_code[i],
      description: WMO_DESCRIPTIONS[daily.weather_code[i]] ?? 'Unknown',
      tempMax: daily.temperature_2m_max[i],
      tempMin: daily.temperature_2m_min[i],
      precipSum: daily.precipitation_sum[i],
      precipProbability: daily.precipitation_probability_max[i],
      windMax: daily.wind_speed_10m_max[i],
      goodWeather: isMowingDay(daily.precipitation_sum[i], daily.precipitation_probability_max[i], prevPrecip),
      hours: hourlyByDate[date] ?? [],
    };
  });

  return {
    current: current ? {
      temperature: current.temperature_2m,
      weatherCode: current.weather_code,
      description: WMO_DESCRIPTIONS[current.weather_code] ?? 'Unknown',
      precipitation: current.precipitation,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
    } : null,
    forecast,
    units: {
      temperature: daily_units?.temperature_2m_max ?? '°C',
      precipitation: daily_units?.precipitation_sum ?? 'mm',
      wind: daily_units?.wind_speed_10m_max ?? 'km/h',
    },
  };
}

// Geocode a full street address to coordinates via OpenStreetMap Nominatim
// (keyless + CORS-open). Client-direct (D2 / §9.1 P5b). We can't use open-meteo's
// geocoder here: it only matches place/city names and returns nothing for a full
// home address. Nominatim resolves the full address exactly like the old server
// path (server/services/weather.js). RN fetch sends the User-Agent per Nominatim's
// usage policy; browsers ignore it but send a Referer, which also satisfies it.
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'HouseholdCalendar/1.0 (household management app)' },
  });
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  const r = data && data[0];
  if (!r) throw new Error('Could not find that location — check your address in Settings');
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
}

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code',
    current: 'temperature_2m,weather_code,precipitation,relative_humidity_2m,wind_speed_10m',
    timezone: 'auto',
    forecast_days: '7',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!res.ok) throw new Error('Weather fetch failed');
  return res.json();
}

// One call: address -> geocode -> forecast -> built shape.
async function loadWeatherForAddress(address) {
  const { lat, lon } = await geocode(address);
  const raw = await fetchWeather(lat, lon);
  return buildForecast(raw);
}

// ── Secondary surfaces (§9.1 P5b follow-ups): client-direct range + outlook ──
// Post-drop the server can't read the home address, so the calendar weather
// overlay and the 90-day outlook fetch from the decrypted coords directly. No
// server WeatherRecord cache — each client fetches its own (accepted in D2).

// open-meteo historical archive (past daily observations). Keyless + CORS-open.
async function fetchWeatherArchive(lat, lon, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: startDate,
    end_date: endDate,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max',
    timezone: 'auto',
  });
  const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`);
  if (!res.ok) throw new Error('Weather archive fetch failed');
  return res.json();
}

// Pure: one archive `daily` day -> the calendar record shape (mirrors the
// server WeatherRecord fields the calendar overlay reads).
function archiveDayToRecord(daily, i) {
  const precipSum = daily.precipitation_sum[i] ?? 0;
  const prevPrecip = i > 0 ? (daily.precipitation_sum[i - 1] ?? 0) : 0;
  const weatherCode = daily.weather_code[i];
  return {
    date: daily.time[i],
    weatherCode,
    description: WMO_DESCRIPTIONS[weatherCode] ?? 'Unknown',
    tempMax: daily.temperature_2m_max[i],
    tempMin: daily.temperature_2m_min[i],
    precipSum,
    precipProbability: null,
    windMax: daily.wind_speed_10m_max[i],
    goodWeather: isMowingDay(precipSum, null, prevPrecip),
  };
}

// Pure: assemble the calendar overlay records for [from,to] from an archive
// response (past days) + a built forecast (today onward). Forecast wins on any
// overlapping date. Returns records sorted by date, clipped to [from,to].
function buildRangeRecords({ archiveRaw, forecast, from, to }) {
  const byDate = {};
  if (archiveRaw && archiveRaw.daily && archiveRaw.daily.time) {
    archiveRaw.daily.time.forEach((date, i) => {
      if (date >= from && date <= to) byDate[date] = archiveDayToRecord(archiveRaw.daily, i);
    });
  }
  for (const day of forecast || []) {
    if (day.date >= from && day.date <= to) {
      byDate[day.date] = {
        date: day.date,
        weatherCode: day.weatherCode,
        description: day.description,
        tempMax: day.tempMax,
        tempMin: day.tempMin,
        precipSum: day.precipSum,
        precipProbability: day.precipProbability,
        windMax: day.windMax,
        goodWeather: day.goodWeather,
        hours: day.hours ?? [],
      };
    }
  }
  return Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Orchestration: address -> the calendar overlay `records` for [from,to].
async function loadWeatherRange(address, from, to) {
  const { lat, lon } = await geocode(address);
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const archiveEnd = yesterday < to ? yesterday : to;

  const [archiveRaw, forecastBuilt] = await Promise.all([
    from <= archiveEnd ? fetchWeatherArchive(lat, lon, from, archiveEnd).catch(() => null) : Promise.resolve(null),
    to >= todayStr ? fetchWeather(lat, lon).then(buildForecast).catch(() => null) : Promise.resolve(null),
  ]);
  return { records: buildRangeRecords({ archiveRaw, forecast: forecastBuilt?.forecast, from, to }) };
}

// Pure: roll up the past-N-years archive responses into weekly averages (the
// 90-day seasonal outlook). Mirrors the server /outlook math exactly.
function buildOutlook(archiveResults, { today = new Date(), days = 90 } = {}) {
  const dailyAvg = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const maxTemps = [], minTemps = [], precips = [];
    for (const ar of archiveResults) {
      if (!ar || !ar.daily || i >= ar.daily.time.length) continue;
      if (ar.daily.temperature_2m_max[i] != null) maxTemps.push(ar.daily.temperature_2m_max[i]);
      if (ar.daily.temperature_2m_min[i] != null) minTemps.push(ar.daily.temperature_2m_min[i]);
      if (ar.daily.precipitation_sum[i] != null) precips.push(ar.daily.precipitation_sum[i]);
    }
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    dailyAvg.push({
      date: date.toISOString().slice(0, 10),
      avgTempMax: avg(maxTemps),
      avgTempMin: avg(minTemps),
      avgPrecip: avg(precips),
    });
  }

  const weeks = [];
  for (let w = 0; w < Math.ceil(days / 7); w++) {
    const slice = dailyAvg.slice(w * 7, (w + 1) * 7).filter((d) => d.avgTempMax != null);
    if (!slice.length) break;
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    weeks.push({
      startDate: slice[0].date,
      endDate: slice[slice.length - 1].date,
      avgTempMax: Math.round(avg(slice.map((d) => d.avgTempMax))),
      avgTempMin: Math.round(avg(slice.map((d) => d.avgTempMin))),
      totalPrecip: Math.round(slice.reduce((a, d) => a + (d.avgPrecip ?? 0), 0) * 10) / 10,
      rainyDays: slice.filter((d) => (d.avgPrecip ?? 0) >= 1).length,
      yearsInSample: archiveResults.length,
    });
  }
  return { weeks };
}

// Orchestration: address -> 90-day seasonal outlook (averages the same window
// across the past 3 years).
async function loadOutlook(address, { today = new Date(), days = 90 } = {}) {
  const { lat, lon } = await geocode(address);
  const archiveResults = (
    await Promise.all(
      [1, 2, 3].map((yearsAgo) => {
        const start = new Date(today); start.setFullYear(start.getFullYear() - yearsAgo);
        const end = new Date(today); end.setDate(end.getDate() + days - 1); end.setFullYear(end.getFullYear() - yearsAgo);
        return fetchWeatherArchive(lat, lon, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)).catch(() => null);
      }),
    )
  ).filter(Boolean);
  return buildOutlook(archiveResults, { today, days });
}

module.exports = {
  WMO_DESCRIPTIONS, isMowingDay, buildForecast, geocode, fetchWeather, loadWeatherForAddress,
  fetchWeatherArchive, buildRangeRecords, loadWeatherRange, buildOutlook, loadOutlook,
};
