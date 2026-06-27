const mongoose = require('mongoose');

const recipeScheduleSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipeId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe', required: true },
  scheduledDate: { type: Date, required: true },
  servings:      Number,
  notes:         String,
}, { timestamps: true });

module.exports = mongoose.model('RecipeSchedule', recipeScheduleSchema);
