const mongoose = require('mongoose');
const { encFields, requiredUntilSealed } = require('./encFields');

const personSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: requiredUntilSealed, index: true },
  // When set, this Person is the self-record for that household member's User
  // account. Self records are always type 'family' and cannot be deleted.
  accountId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
  type:         { type: String, enum: ['family', 'friend', 'service'], required: true },
  name:         { type: String, required: requiredUntilSealed, trim: true },
  relationship: { type: String, trim: true },  // e.g. "spouse", "daughter", "neighbor"
  birthday:     { type: Date },
  interests:    [{ type: String, trim: true }],
  notes:        { type: String, trim: true },
  address:      { type: String, trim: true },
  // Professionals split the old combined "Address or business" field into a
  // business name + its address. Only meaningful for type 'service'.
  businessName: { type: String, trim: true },
  phone:        { type: String, trim: true },
  email:        { type: String, trim: true },
  // The device address-book id this Person was imported from, when applicable.
  // Lets a later import warn before re-creating the same contact. Opaque + not
  // sensitive content, so it stays plaintext (never in the enc blob).
  deviceContactId: { type: String, trim: true, index: true, sparse: true },
  // E2EE dual-write ciphertext (Phase 3+): see models/encFields.js.
  ...encFields,
}, { timestamps: true });

// Ensure the given User has a linked self-record in the People roster, creating
// one from the account's profile fields on first call. Idempotent and cheap
// (indexed findOne when the record already exists). Returns the self Person.
personSchema.statics.ensureSelf = async function (user) {
  let self = await this.findOne({ accountId: user._id });
  if (!self) {
    // Under E2EE the server can't create readable content. Once the household's
    // plaintext has been dropped, the client owns seeding an *encrypted* self-
    // Person after first unlock — so the server must not create a plaintext one.
    // Pre-drop (e2eeActive false, the default), behavior is unchanged.
    const Household = mongoose.model('Household');
    const hh = user.householdId
      ? await Household.findById(user.householdId).select('e2eeActive').lean()
      : null;
    if (hh?.e2eeActive) return null; // client seeds the encrypted self-Person
    self = await this.create({
      userId:    user._id,
      accountId: user._id,
      type:      'family',
      name:      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.firstName,
      birthday:  user.birthday,
      address:   user.homeAddress || undefined,
      interests: user.interests || [],
      notes:     user.aboutMe || undefined,
    });
  }
  if (!user.personId || String(user.personId) !== String(self._id)) {
    await mongoose.model('User').updateOne({ _id: user._id }, { $set: { personId: self._id } });
  }
  return self;
};

module.exports = mongoose.model('Person', personSchema);
