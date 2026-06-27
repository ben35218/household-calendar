const mongoose = require('mongoose');

const hourSchema = new mongoose.Schema({
  time:              String,
  hour:              Number,
  temperature:       Number,
  precipProbability: Number,
  precipitation:     Number,
  weatherCode:       Number,
  description:       String,
}, { _id: false });

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:   { type: String, required: true }, // 'yyyy-MM-dd'
  weatherCode:      Number,
  description:      String,
  tempMax:          Number,
  tempMin:          Number,
  precipSum:        Number,
  precipProbability: Number, // null for archive records (not measured)
  windMax:          Number,
  goodWeather:      Boolean,
  hours:            [hourSchema],
}, { timestamps: false });

schema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('WeatherRecord', schema);
