const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  name:      { type: String, required: true },
  icon:      { type: String, default: 'mdi-circle-small' },
  color:     { type: String, default: '#9E9E9E' },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Category', categorySchema);
