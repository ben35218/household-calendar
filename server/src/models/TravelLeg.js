const mongoose = require('mongoose');

// Cache of computed travel times between two endpoints for a given mode, so we
// don't re-bill the Google Routes API every time an itinerary day is viewed.
// Keyed by origin/dest reference ("place:<id>" or "addr:<text>") + mode.
const travelLegSchema = new mongoose.Schema({
  originKey:  { type: String, required: true },
  destKey:    { type: String, required: true },
  mode:       { type: String, required: true },
  minutes:    Number,
  distanceKm: Number,
  computedAt: { type: Date, default: Date.now },
});

travelLegSchema.index({ originKey: 1, destKey: 1, mode: 1 }, { unique: true });

module.exports = mongoose.model('TravelLeg', travelLegSchema);
