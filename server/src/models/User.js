const mongoose = require('mongoose');

// One push subscription per device the user opted in from. Two flavours:
//   - web:    Web Push (browser) — has `endpoint` + `keys`.
//   - native: a mobile app (Expo) — has `expoToken`.
// `platform` discriminates them so the push service can pick a transport.
const pushSubscriptionSchema = new mongoose.Schema({
  platform:  { type: String, enum: ['web', 'ios', 'android'], default: 'web' },
  endpoint:  { type: String },                      // web push only
  keys:      { p256dh: String, auth: String },      // web push only
  expoToken: { type: String },                      // native (Expo) only
  label:     String,        // user-agent / device hint for management
}, { _id: false, timestamps: true });

const userSchema = new mongoose.Schema({
  email:             { type: String, required: true, unique: true, lowercase: true },
  passwordHash:      { type: String, required: true },
  // Access role. 'admin' unlocks the monetization/admin web app surfaces.
  role:              { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  householdId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Household' }, // family the user belongs to
  personId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Person' },    // optional link to the People roster
  firstName:         { type: String, required: true, trim: true },
  lastName:          { type: String, trim: true, default: '' },
  birthday:          { type: Date },
  // Lead-time (days) used by the tasks/chores "due-soon" list filter. Not a
  // notification setting — alerts are configured per item now.
  reminderLeadDays:  { type: Number, default: 7 },
  // Push opt-ins (web + native) — push is the only notification delivery channel.
  pushSubscriptions: { type: [pushSubscriptionSchema], default: [] },
  timezone:          { type: String, default: 'America/Toronto' },
  homeAddress:       { type: String, default: '' },
  lat:               { type: Number },
  lon:               { type: Number },
  interests:           [{ type: String, trim: true }],
  aboutMe:             { type: String, trim: true },
  groceryShoppingDay:  { type: Number, default: 6 },  // 0=Sun...6=Sat, default Saturday
  grocerySections:     { type: [String], default: () => ['Produce', 'Deli', 'Bakery', 'Meat & Seafood', 'Dairy', 'Frozen', 'Pantry', 'Other'] },
}, { timestamps: true, toJSON: { virtuals: true } });

// Convenience getter so existing code using req.user.name keeps working
userSchema.virtual('name').get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

module.exports = mongoose.model('User', userSchema);
