const fs = require('fs');
const path = require('path');
const Recipe = require('../models/Recipe');

const recipesDir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'recipes');

// Files younger than this are spared — they may belong to an in-progress import
// that hasn't been saved yet (e.g. user still reviewing the extracted recipe).
const GRACE_MS = 24 * 60 * 60 * 1000;

// Delete recipe upload files that no saved recipe references and that are older
// than the grace window. Handles photos extracted but never saved (the import
// flow keeps the file on disk so the form can save it later).
async function cleanupOrphanUploads() {
  let files;
  try {
    files = await fs.promises.readdir(recipesDir);
  } catch (err) {
    if (err.code === 'ENOENT') return; // nothing uploaded yet
    console.error('[cleanupOrphanUploads] readdir failed:', err.message);
    return;
  }
  if (!files.length) return;

  // Basenames still referenced by a recipe's imageUrl (/uploads/recipes/<name>)
  const docs = await Recipe.find(
    { imageUrl: { $exists: true, $ne: null } },
    'imageUrl'
  ).lean();
  const referenced = new Set(docs.map(d => path.basename(d.imageUrl)));

  const cutoff = Date.now() - GRACE_MS;
  let removed = 0;

  for (const name of files) {
    if (referenced.has(name)) continue;
    const filePath = path.join(recipesDir, name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.mtimeMs > cutoff) continue;
      await fs.promises.unlink(filePath);
      removed++;
    } catch (err) {
      console.error(`[cleanupOrphanUploads] ${name}:`, err.message);
    }
  }

  if (removed) console.log(`[cleanupOrphanUploads] Removed ${removed} orphaned upload(s)`);
}

module.exports = { cleanupOrphanUploads };
