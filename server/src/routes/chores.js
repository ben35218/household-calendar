const express = require('express');
const { requireAuth } = require('../middleware/auth');

// Signal-parity C3b: chore content (CRUD + the pause/resume `active` toggle) moved
// to the unified opaque store. The client reads chores from its replica (populated
// by /records/sync) and writes them through /records — the server never learns the
// collection type. This router is retained (mounted) but content-free; every old
// /chores endpoint is gone.
const router = express.Router();
router.use(requireAuth);

module.exports = router;
