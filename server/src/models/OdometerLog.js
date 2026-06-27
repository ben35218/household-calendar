const mongoose = require('mongoose');

const odometerLogSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itemId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  reading:    { type: Number, required: true },   // km
  recordedAt: { type: Date, default: Date.now },
  notes:      { type: String },
}, { timestamps: true });

odometerLogSchema.index({ itemId: 1, recordedAt: -1 });

module.exports = mongoose.model('OdometerLog', odometerLogSchema);
