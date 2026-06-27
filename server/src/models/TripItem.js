const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  storageKey:    { type: String, required: true },   // random on-disk filename
  filename:      String,                              // original name for display/download
  fileType:      String,                              // mimetype
  fileSizeBytes: Number,
  householdId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Household' }, // uploader's family (private unless one shared bill)
  uploadedAt:    { type: Date, default: Date.now },
}, { _id: true });

const tripItemSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tripId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  type:         { type: String, enum: ['flight', 'hotel', 'car-rental', 'restaurant', 'activity', 'transit', 'other'], required: true },
  title:        { type: String, required: true },
  start:        { type: Date, required: true },   // wall-clock at destination
  end:          Date,                             // optional (hotels: check-out; flights: arrival)
  location:     String,
  placeId:      String,
  address:      String,
  confirmation: String,
  cost:         Number,
  currency:     String,
  url:          String,
  phone:        String,
  notes:        String,
  details:      mongoose.Schema.Types.Mixed,      // type-specific extras (flightNumber, terminal, seat, nights, etc.)
  attachments:  [attachmentSchema],               // confirmation files (PDF/image)

  // ── Cost sharing across families on the trip ──────────────────────────────────
  householdId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Household', index: true }, // creator's family (snapshot)
  // private             = visible only to the creator's household.
  // shared_separate     = separate bookings: plan shared with participants, but
  //                       cost/currency/confirmation/partySize PRIVATE per family
  //                       (householdData); per-family confirmed status.
  // shared_one_separate = ONE booking (shared confirmation # + single booked flag),
  //                       but each family's bill (cost/currency) is PRIVATE.
  // shared_shared       = ONE booking, ONE shared bill split via shares[] (settle-up).
  sharing:      { type: String, enum: ['private', 'shared_separate', 'shared_one_separate', 'shared_shared'], default: 'private' },
  confirmed:    { type: Boolean, default: false },   // private / shared_one_separate / shared_shared: booked?
  // shared_shared split:
  shares:       [{
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
    amount:      Number,   // this family's portion, in the booking's currency
  }],
  paidByHouseholdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' }, // shared_shared only
  // shared_separate per-family private fields (never sent to other families):
  householdData: [{
    householdId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
    cost:         Number,
    currency:     String,
    confirmation: String,
    partySize:    Number,
    confirmed:    { type: Boolean, default: false },
  }],
}, { timestamps: true });

module.exports = mongoose.model('TripItem', tripItemSchema);
