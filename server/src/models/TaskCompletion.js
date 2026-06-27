const mongoose = require('mongoose');

const taskCompletionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaintenanceTask', required: true },
  completedDate: { type: Date, required: true },
  cost: Number,
  notes: String,
  performedBy: { type: String, default: 'self' },
  odometerReading: Number,
  attachmentRef: String,
  nextDueDateAfter: Date,
}, { timestamps: true });

module.exports = mongoose.model('TaskCompletion', taskCompletionSchema);
