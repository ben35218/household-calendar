const express = require('express');
const User = require('../models/User');
const Household = require('../models/Household');
const Person = require('../models/Person');
const { requireAuth } = require('../middleware/auth');
const { pickRecordEnc } = require('../services/householdKey');

const router = express.Router();
router.use(requireAuth);

// Settings shared across the household vs. personal to the user account.
// Interests / aboutMe (notes) now live on the user's self Person record,
// managed from the People page — not here. Notifications are no longer a global
// setting — alerts are configured per item and delivered via push.
// timezone is personal: alerts fire at each member's own 7am local, so a
// travelling or out-of-town member gets correct timing regardless of the
// household's default zone.
const SHARED   = ['homeAddress', 'groceryShoppingDay', 'grocerySections', 'reminderLeadDays'];
const PERSONAL = ['firstName', 'lastName', 'birthday', 'timezone'];

router.get('/', async (req, res) => {
  const u = req.user;
  const hh = req.household || u;   // fall back to user during transition
  // Member count drives whether per-item alert "audience" pickers are shown.
  const memberCount = req.household
    ? await User.countDocuments({ householdId: req.household._id })
    : 1;
  res.json({
    email: u.email,
    firstName: u.firstName, lastName: u.lastName, birthday: u.birthday,
    timezone: u.timezone,
    // shared (household)
    homeAddress: hh.homeAddress,
    groceryShoppingDay: hh.groceryShoppingDay, grocerySections: hh.grocerySections,
    reminderLeadDays: hh.reminderLeadDays,
    householdMemberCount: memberCount,
    // Encrypted home-location blob (§9.1 P5) so the client can decrypt the address
    // after the drop. householdId lets the client bind the AAD.
    householdId: req.household?._id,
    enc: req.household?.enc,
    keyVersion: req.household?.keyVersion,
  });
});

router.put('/', async (req, res) => {
  try {
    const userUpdate = {};
    for (const key of PERSONAL) if (req.body[key] !== undefined) userUpdate[key] = req.body[key];

    const hhUpdate = {};
    for (const key of SHARED) if (req.body[key] !== undefined) hhUpdate[key] = req.body[key];
    // Bust cached geocoordinates when the home address changes
    if (hhUpdate.homeAddress !== undefined) { hhUpdate.lat = null; hhUpdate.lon = null; }
    // Encrypted home-location blob (§9.1 P5), when the client sealed it.
    try { Object.assign(hhUpdate, pickRecordEnc(req.body)); }
    catch (msg) { return res.status(400).json({ error: msg }); }

    const [user] = await Promise.all([
      Object.keys(userUpdate).length
        ? User.findByIdAndUpdate(req.user._id, userUpdate, { new: true }).select('-passwordHash')
        : Promise.resolve(req.user),
      (Object.keys(hhUpdate).length && req.household)
        ? Household.updateOne({ _id: req.household._id }, { $set: hhUpdate })
        : Promise.resolve(),
    ]);

    // Keep the user's self-record in the People roster in sync with their
    // account identity (name / birthday / home address). Post-drop the client
    // maintains the *encrypted* self-Person, so the server skips this to avoid
    // writing plaintext content onto an encrypted record.
    if (!req.household?.e2eeActive) {
      const self = await Person.ensureSelf(user);
      if (self) {
        const selfUpdate = {};
        if (userUpdate.firstName !== undefined || userUpdate.lastName !== undefined) {
          selfUpdate.name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.firstName;
        }
        if (userUpdate.birthday !== undefined) selfUpdate.birthday = user.birthday;
        if (hhUpdate.homeAddress !== undefined) selfUpdate.address = hhUpdate.homeAddress;
        if (Object.keys(selfUpdate).length) await Person.updateOne({ _id: self._id }, { $set: selfUpdate });
      }
    }

    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
