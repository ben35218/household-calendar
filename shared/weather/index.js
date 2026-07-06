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

// Geocode an address to coordinates via open-meteo's keyless geocoding API
// (place/city precision — fine for weather). Client-direct (D2 / §9.1 P5b).
async function geocode(address) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(address)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  const r = data.results && data.results[0];
  if (!r) throw new Error('Could not find that location — check your address in Settings');
  return { lat: r.latitude, lon: r.longitude };
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

module.exports = { WMO_DESCRIPTIONS, isMowingDay, buildForecast, geocode, fetchWeather, loadWeatherForAddress };
