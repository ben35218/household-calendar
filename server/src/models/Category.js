const mongoose = require('mongoose');
const { encFields, requiredUntilSealed } = require('./encFields');

const categorySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: requiredUntilSealed },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  // Content (sealed into `enc`, nulled at the §9 drop); icon/color/sortOrder
  // stay plaintext presentation metadata.
  name:      { type: String },
  icon:      { type: String, default: 'mdi-circle-small' },
  color:     { type: String, default: '#9E9E9E' },
  sortOrder: { type: Number, default: 0 },
  // E2EE dual-write ciphertext: see models/encFields.js.
  ...encFields,
}, { timestamps: true });

module.exports = mongoose.model('Category', categorySchema);
