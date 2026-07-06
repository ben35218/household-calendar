const mongoose = require('mongoose');
const { encFields } = require('./encFields');

const candidateRangeSchema = new mongoose.Schema({
  start: { type: Date, required: true },
  end:   { type: Date, required: true },
  label: String,
  note:  String,
}, { _id: true });

const tripSchema = new mongoose.Schema({
  userId:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:               { type: String, required: true },
  destination:        String,
  destinationPlaceId: String,
  destinationTz:      String,   // display label only, e.g. "Europe/Rome"
  status:             { type: String, enum: ['considering', 'booked', 'completed'], default: 'considering' },
  candidateRanges:    [candidateRangeSchema],
  startDate:          Date,     // confirmed window (booked stage)
  endDate:            Date,
  notes:              String,
  color:              { type: String, default: '#5E35B1' },
  budget:             Number,                                  // planned spend, in baseCurrency
  baseCurrency:       { type: String, default: 'CAD' },        // currency the roll-up totals into
  collaborators:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // shared with (outside household)
  shareCode:          { type: String, index: true },           // per-trip invite code
  // Per-family budget for this trip (the owning family + each collaborator family).
  householdBudgets:   [{
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
    budget:      Number,
    baseCurrency: { type: String, default: 'CAD' },
  }],
  // Settle-up payments recorded between families (offsets the computed debts).
  settlePayments:     [{
    fromHouseholdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
    toHouseholdId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
    amount:          Number,
    currency:        { type: String, default: 'CAD' },
    date:            { type: Date, default: Date.now },
    note:            String,
  }],
  // E2EE dual-write ciphertext (Phase 3+): see models/encFields.js.
  ...encFields,
}, { timestamps: true });

module.exports = mongoose.model('Trip', tripSchema);
