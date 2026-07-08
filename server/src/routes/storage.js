const express = require('express');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const CalendarEvent = require('../models/CalendarEvent');
const Person = require('../models/Person');
const MaintenanceTask = require('../models/MaintenanceTask');
const Chore = require('../models/Chore');
const Recipe = require('../models/Recipe');
const Trip = require('../models/Trip');
const Item = require('../models/Item');
const FoodInventory = require('../models/FoodInventory');
const mailer = require('../services/mailer');
const {
  purgeDateFrom,
  canGoLocal,
  cancelDeletionSet,
  buildManifest,
  manifestsMatch,
} = require('../services/cloudDeletion');

// Storage-mode / cloud-purge lifecycle (Phase 6, §6). A SOLO user may switch to
// "store on this device only": after a verified download-first local copy the
// server schedules a 7-day purge of their cloud ciphertext, with an undo window
// (switch back before the deadline). A household member can't go local (§6.1) —
// shared data stays in the encrypted cloud.
const router = express.Router();
router.use(requireAuth);

// Collections whose records are proved complete in the download-first manifest
// (§6.2). Client and server MUST enumerate the same set for the counts/hash to
// match. Attachments (manuals/photos) and any not-yet-replicated data are NOT
// covered here — which is one reason the destructive purge stays deferred until
// a fuller replica lands (§6 / §9.2).
const MANIFEST_MODELS = {
  CalendarEvent,
  Person,
  MaintenanceTask,
  Chore,
  Recipe,
  Trip,
  Item,
  FoodInventory,
};

// Build the server's own manifest over this user's records (all of them, no
// status/range filter — completeness is the whole point). Solo only, so the
// user's own userId is the full scope.
async function serverManifest(userId) {
  const records = [];
  for (const [collection, Model] of Object.entries(MANIFEST_MODELS)) {
    const rows = await Model.find({ userId }).select('_id updatedAt').lean();
    for (const r of rows) records.push({ _id: r._id, collection, updatedAt: r.updatedAt });
  }
  return buildManifest(records);
}

function stateOf(user) {
  return {
    storageMode: user.storageMode || 'cloud',
    cloudDeletionState: user.cloudDeletionState || 'none',
    cloudDeletionScheduledAt: user.cloudDeletionScheduledAt || null,
    localReplicaVerifiedAt: user.localReplicaVerifiedAt || null,
  };
}

// Current storage-mode + purge state (drives the countdown banner). `canGoLocal`
// reflects the solo guard so the client can disable the option for members.
router.get('/', (req, res) => {
  res.json({
    ...stateOf(req.user),
    canGoLocal: canGoLocal({ memberCount: req.scopeIds.length }),
    memberCount: req.scopeIds.length,
  });
});

// Switch to local-only (§6.2). Verifies the download-first manifest against the
// server's own, then — only on a match — records the verification, sets the mode
// to local, and schedules a 7-day purge. Never schedules against an unverified
// replica (the match check and the schedule happen atomically here).
router.post('/switch-to-local', async (req, res) => {
  try {
    if (!canGoLocal({ memberCount: req.scopeIds.length })) {
      return res.status(409).json({ error: 'Only a solo user can store data on-device only' });
    }
    const clientManifest = req.body?.manifest;
    if (!clientManifest) return res.status(400).json({ error: 'manifest required' });

    const server = await serverManifest(req.user._id);
    const cmp = manifestsMatch(clientManifest, server);
    if (!cmp.match) {
      return res.status(409).json({
        error: 'Local copy is incomplete — download-first verification failed',
        reasons: cmp.reasons,
        serverManifest: server,
      });
    }

    const now = new Date();
    const scheduledAt = purgeDateFrom(now);
    await User.updateOne({ _id: req.user._id }, {
      $set: {
        storageMode: 'local',
        cloudDeletionScheduledAt: scheduledAt,
        cloudDeletionState: 'scheduled',
        localReplicaVerifiedAt: now,
        localReplicaManifestHash: server.hash,
      },
    });
    await AuditLog.create({
      userId: req.user._id,
      householdId: req.user.householdId || null,
      event: 'deletion_scheduled',
      meta: { scheduledAt, manifestHash: server.hash, total: server.total },
    });
    mailer.sendDeletionScheduled(req.user, scheduledAt).catch(() => {});

    const fresh = await User.findById(req.user._id).lean();
    res.json(stateOf(fresh));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Switch back to cloud (§6.3 undo). Cancels a pending purge if one is scheduled;
// resumes cloud sync. Idempotent — a no-op state just returns the current state.
router.post('/switch-to-cloud', async (req, res) => {
  try {
    const wasScheduled = req.user.cloudDeletionState === 'scheduled';
    await User.updateOne({ _id: req.user._id }, { $set: cancelDeletionSet() });
    if (wasScheduled) {
      await AuditLog.create({
        userId: req.user._id,
        householdId: req.user.householdId || null,
        event: 'deletion_canceled',
      });
      mailer.sendDeletionCanceled(req.user).catch(() => {});
    }
    const fresh = await User.findById(req.user._id).lean();
    res.json(stateOf(fresh));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.MANIFEST_MODELS = MANIFEST_MODELS;
module.exports.serverManifest = serverManifest;
