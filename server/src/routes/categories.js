const express = require('express');
const { requireAuth } = require('../middleware/auth');

// Signal-parity C3b: category content (CRUD) moved to the unified opaque store. The
// client reads categories from its replica (populated by /records/sync) and writes
// them through /records; reassign-on-delete is client-side (it re-seals affected
// items to the replacement category before tombstoning the category — the server
// can't read a sealed categoryId to rebucket). This router is retained (mounted)
// but content-free.
const router = express.Router();
router.use(requireAuth);

module.exports = router;
