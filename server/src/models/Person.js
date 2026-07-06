const mongoose = require('mongoose');
const { encFields } = require('./encFields');

const personSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // When set, this Person is the self-record for that household member's User
  // account. Self records are always type 'family' and cannot be deleted.
  accountId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
  type:         { type: String, enum: ['family', 'friend', 'service'], required: true },
  name:         { type: String, required: true, trim: true },
  relationship: { type: String, trim: true },  // e.g. "spouse", "daughter", "neighbor"
  birthday:     { type: Date },
  interests:    [{ type: String, trim: true }],
  notes:        { type: String, trim: true },
  address:      { type: String, trim: true },
  phone:        { type: String, trim: true },
  email:        { type: String, trim: true },
  // E2EE dual-write ciphertext (Phase 3+): see models/encFields.js.
  ...encFields,
}, { timestamps: true });

// Ensure the given User has a linked self-record in the People roster, creating
// one from the account's profile fields on first call. Idempotent and cheap
// (indexed findOne when the record already exists). Returns the self Person.
personSchema.statics.ensureSelf = async function (user) {
  let self = await this.findOne({ accountId: user._id });
  if (!self) {
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
