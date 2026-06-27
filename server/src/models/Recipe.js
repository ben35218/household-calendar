const mongoose = require('mongoose');

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
  tags:                    [String],
}, { timestamps: true });

module.exports = mongoose.model('Recipe', recipeSchema);
