const express = require('express');
const User = require('../models/User');
const Household = require('../models/Household');
const WeatherRecord = require('../models/WeatherRecord');
const { requireAuth } = require('../middleware/auth');
const {
  WMO_DESCRIPTIONS, isMowingDay,
  geocodeAddress, fetchWeather, fetchWeatherArchive, buildForecast,
} = require('../services/weather');

const router = express.Router();
router.use(requireAuth);

// Location is a shared household setting; coords are cached on the household.
async function getCoords(household) {
  if (household.lat && household.lon) return { lat: household.lat, lon: household.lon };
  const coords = await geocodeAddress(household.homeAddress);
  await Household.findByIdAndUpdate(household._id, coords);
  return coords;
}

function forecastToRecord(userId, day) {
  return {
    userId,
    date:              day.date,
    weatherCode:       day.weatherCode,
    description:       day.description,
    tempMax:           day.tempMax,
    tempMin:           day.tempMin,
    precipSum:         day.precipSum,
    precipProbability: day.precipProbability,
    windMax:           day.windMax,
    goodWeather:       day.goodWeather,
    hours:             day.hours ?? [],
  };
}

// Existing endpoint — returns full forecast with hourly data for WeatherWidget
router.get('/', async (req, res) => {
  try {
    const household = req.household;
    if (!household?.homeAddress) return res.status(400).json({ error: 'No home address configured. Add one in Settings.' });

    const { lat, lon } = await getCoords(household);
    const raw = await fetchWeather(lat, lon);
    const result = buildForecast(raw);

    // Persist forecast days so they become part of the weather history
    const ops = result.forecast.map(day => ({
      updateOne: {
        filter: { userId: (req.household?.ownerId || req.user._id), date: day.date },
        update: { $set: forecastToRecord((req.household?.ownerId || req.user._id), day) },
        upsert: true,
      },
    }));
    WeatherRecord.bulkWrite(ops).catch(() => {});

    res.json(result);
  } catch (err) {
    console.error('[Weather]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Range endpoint — returns stored daily records for the calendar, backfilling from the
// Open-Meteo archive API for any past dates not yet in the database
router.get('/range', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const household = req.household;
    if (!household?.homeAddress) return res.json({ records: [] });

    // One-time migration: rename legacy goodForMowing → goodWeather
    await WeatherRecord.updateMany(
      { userId: (req.household?.ownerId || req.user._id), goodForMowing: { $exists: true } },
      { $rename: { goodForMowing: 'goodWeather' } }
    ).catch(() => {});

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Load whatever we already have stored
    const stored = await WeatherRecord.find({
      userId: (req.household?.ownerId || req.user._id),
      date: { $gte: from, $lte: to },
    }).lean();
    const storedDates = new Set(stored.map(r => r.date));

    // Find missing dates in the past portion of the requested range
    const archiveEnd = yesterday < to ? yesterday : to;
    const missing = [];
    if (from <= archiveEnd) {
      let d = new Date(from + 'T12:00:00Z');
      const end = new Date(archiveEnd + 'T12:00:00Z');
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        if (!storedDates.has(ds)) missing.push(ds);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }

    if (missing.length) {
      try {
        const { lat, lon } = await getCoords(household);
        const archiveRaw = await fetchWeatherArchive(lat, lon, missing[0], missing[missing.length - 1]);

        if (archiveRaw.daily) {
          const { time, weather_code, temperature_2m_max, temperature_2m_min, precipitation_sum, wind_speed_10m_max } = archiveRaw.daily;
          const ops = [];
          const newRecords = [];

          time.forEach((date, i) => {
            const precipSum = precipitation_sum[i] ?? 0;
            const prevPrecip = i > 0 ? (precipitation_sum[i - 1] ?? 0) : 0;
            const weatherCode = weather_code[i];
            const record = {
              userId:            (req.household?.ownerId || req.user._id),
              date,
              weatherCode,
              description:       WMO_DESCRIPTIONS[weatherCode] ?? 'Unknown',
              tempMax:           temperature_2m_max[i],
              tempMin:           temperature_2m_min[i],
              precipSum,
              precipProbability: null,
              windMax:           wind_speed_10m_max[i],
              goodWeather:     isMowingDay(precipSum, null, prevPrecip),
            };
            ops.push({ updateOne: { filter: { userId: (req.household?.ownerId || req.user._id), date }, update: { $set: record }, upsert: true } });
            newRecords.push(record);
          });

          await WeatherRecord.bulkWrite(ops);
          stored.push(...newRecords);
        }
      } catch (archiveErr) {
        // Archive fetch failed — return whatever we have
        console.error('[Weather/archive]', archiveErr.message);
      }
    }

    // Also include current forecast days if they fall within the range
    // (they were upserted by GET / but if the widget hasn't loaded, fetch now)
    const hasForecast = stored.some(r => r.date >= today);
    if (!hasForecast && to >= today) {
      try {
        const { lat, lon } = await getCoords(household);
        const raw = await fetchWeather(lat, lon);
        const result = buildForecast(raw);
        const forecastOps = result.forecast.map(day => ({
          updateOne: {
            filter: { userId: (req.household?.ownerId || req.user._id), date: day.date },
            update: { $set: forecastToRecord((req.household?.ownerId || req.user._id), day) },
            upsert: true,
          },
        }));
        await WeatherRecord.bulkWrite(forecastOps);
        result.forecast.forEach(day => {
          if (day.date >= from && day.date <= to) stored.push(forecastToRecord((req.household?.ownerId || req.user._id), day));
        });
      } catch (forecastErr) {
        console.error('[Weather/forecast]', forecastErr.message);
      }
    }

    res.json({ records: stored });
  } catch (err) {
    console.error('[Weather/range]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 90-day seasonal outlook — averages same window across past 3 years
router.get('/outlook', async (req, res) => {
  try {
    const household = req.household;
    if (!household?.homeAddress) return res.status(400).json({ error: 'No home address configured. Add one in Settings.' });

    const { lat, lon } = await getCoords(household);

    const today = new Date();
    const DAYS = 90;

    // Fetch the same 90-day window for each of the past 3 years
    const archiveFetches = [1, 2, 3].map(yearsAgo => {
      const start = new Date(today); start.setFullYear(start.getFullYear() - yearsAgo);
      const end   = new Date(today); end.setDate(end.getDate() + DAYS - 1); end.setFullYear(end.getFullYear() - yearsAgo);
      return fetchWeatherArchive(lat, lon, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
        .catch(() => null);
    });
    const archiveResults = (await Promise.all(archiveFetches)).filter(Boolean);

    // Average each relative day position across all available years
    const dailyAvg = [];
    for (let i = 0; i < DAYS; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);

      const maxTemps = [], minTemps = [], precips = [];
      archiveResults.forEach(ar => {
        if (!ar.daily || i >= ar.daily.time.length) return;
        if (ar.daily.temperature_2m_max[i] != null) maxTemps.push(ar.daily.temperature_2m_max[i]);
        if (ar.daily.temperature_2m_min[i] != null) minTemps.push(ar.daily.temperature_2m_min[i]);
        if (ar.daily.precipitation_sum[i]   != null) precips.push(ar.daily.precipitation_sum[i]);
      });

      const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      dailyAvg.push({
        date:        date.toISOString().slice(0, 10),
        avgTempMax:  avg(maxTemps),
        avgTempMin:  avg(minTemps),
        avgPrecip:   avg(precips),
      });
    }

    // Roll up into weeks
    const weeks = [];
    for (let w = 0; w < Math.ceil(DAYS / 7); w++) {
      const slice = dailyAvg.slice(w * 7, (w + 1) * 7).filter(d => d.avgTempMax != null);
      if (!slice.length) break;
      const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
      weeks.push({
        startDate:    slice[0].date,
        endDate:      slice[slice.length - 1].date,
        avgTempMax:   Math.round(avg(slice.map(d => d.avgTempMax))),
        avgTempMin:   Math.round(avg(slice.map(d => d.avgTempMin))),
        totalPrecip:  Math.round(slice.reduce((a, d) => a + (d.avgPrecip ?? 0), 0) * 10) / 10,
        rainyDays:    slice.filter(d => (d.avgPrecip ?? 0) >= 1).length,
        yearsInSample: archiveResults.length,
      });
    }

    res.json({ weeks });
  } catch (err) {
    console.error('[Weather/outlook]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/geocache', async (req, res) => {
  try {
    await Household.findByIdAndUpdate(req.household._id, { $unset: { lat: 1, lon: 1 } });
    res.json({ message: 'Geocache cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
