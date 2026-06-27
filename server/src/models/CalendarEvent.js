const mongoose = require('mongoose');

const calendarEventSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  calendarType:{ type: String, enum: ['activities', 'appointments'], required: true },
  title:       { type: String, required: true },
  description: String,
  location:    String,
  placeId:     String,
  url:         String,
  startDate:   { type: Date, required: true },
  endDate:     Date,
  allDay:      { type: Boolean, default: true },
  phone:       String,
  travelMinutes:    Number,
  travelDistanceKm: Number,
  reminderMinutes: Number,
  reminderAt:      Date,
  reminderSentAt:  Date,
  alert2Minutes:   Number,
  alert2At:        Date,
  alert2SentAt:    Date,
  // Who the alert goes to in a shared household: 'everyone' or 'owner' (creator).
  alertAudience:   { type: String, enum: ['everyone', 'owner'], default: 'everyone' },
  recurrence: {
    freq:     { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'] },
    interval: { type: Number, default: 1 },
    until:    Date,
  },
}, { timestamps: true });

module.exports = mongoose.model('CalendarEvent', calendarEventSchema);
