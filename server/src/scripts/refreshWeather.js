require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Household = require('../models/Household');
const WeatherRecord = require('../models/WeatherRecord');
const { geocodeAddress, fetchWeather, buildForecast } = require('../services/weather');

async function run() {
  await connectDB();

  // Weather is a household-shared cache keyed by the household owner's id.
  const households = await Household.find({ homeAddress: { $exists: true, $ne: '' } }).lean();
  console.log(`Refreshing weather for ${households.length} household(s)…`);

  for (const hh of households) {
    try {
      let { lat, lon } = hh;
      if (!lat || !lon) {
        ({ lat, lon } = await geocodeAddress(hh.homeAddress));
        await Household.findByIdAndUpdate(hh._id, { lat, lon });
      }

      const raw = await fetchWeather(lat, lon);
      const { forecast } = buildForecast(raw);

      const ops = forecast.map(day => ({
        updateOne: {
          filter: { userId: hh.ownerId, date: day.date },
          update: {
            $set: {
              weatherCode:       day.weatherCode,
              description:       day.description,
              tempMax:           day.tempMax,
              tempMin:           day.tempMin,
              precipSum:         day.precipSum,
              precipProbability: day.precipProbability,
              windMax:           day.windMax,
              goodWeather:       day.goodWeather,
              hours:             day.hours ?? [],
            },
          },
          upsert: true,
        },
      }));

      await WeatherRecord.bulkWrite(ops);
      console.log(`  ✓ ${hh.name} — ${forecast.length} days updated`);
    } catch (err) {
      console.error(`  ✗ ${hh.name || hh._id}: ${err.message}`);
    }
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
