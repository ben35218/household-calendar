const mongoose = require('mongoose');
const { encFields } = require('./encFields');

const ingredientSchema = new mongoose.Schema({
  name:   { type: String, required: true },
  amount: String,
  unit:   String,
}, { _id: false });

const recipeSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:        { type: String, required: true },
  description:  String,
  source:       { type: String, enum: ['url', 'ai', 'manual', 'photo'], default: 'manual' },
  sourceUrl:    String,
  imageUrl:     String,
  servings:     Number,
  prepTimeMins: Number,
  cookTimeMins: Number,
  ingredients:  [ingredientSchema],
  instructions:            [String],
  instructionIngredients:  { type: [[Number]], default: undefined },
  // Per-step timer in minutes (parallel to instructions); null/absent = no timer.
  instructionTimers:       { type: [Number], default: undefined },
  tags:                    [String],
  // E2EE dual-write ciphertext (Phase 3+): see models/encFields.js.
  ...encFields,
}, { timestamps: true });

module.exports = mongoose.model('Recipe', recipeSchema);
