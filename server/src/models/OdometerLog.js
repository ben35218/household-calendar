const mongoose = require('mongoose');
const { encFields, requiredUntilSealed } = require('./encFields');

const odometerLogSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: requiredUntilSealed },
  itemId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  // km — content (sealed into `enc`, nulled at the §9 drop); recordedAt stays
  // plaintext scheduling metadata like every other timestamp.
  reading:    { type: Number },
  recordedAt: { type: Date, default: Date.now },
  notes:      { type: String },
  // E2EE dual-write ciphertext: see models/encFields.js.
  ...encFields,
}, { timestamps: true });

odometerLogSchema.index({ itemId: 1, recordedAt: -1 });

module.exports = mongoose.model('OdometerLog', odometerLogSchema);
