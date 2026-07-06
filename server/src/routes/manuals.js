const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const Manual = require('../models/Manual');
const Item = require('../models/Item');
const MaintenanceTask = require('../models/MaintenanceTask');
const { requireAuth } = require('../middleware/auth');
const { meter } = require('../middleware/usageMeter');
const { findManuals } = require('../services/manualLookup');
const { parseManualForTasks } = require('../services/manualParser');
const { computeNextDueDate } = require('../services/recurrence');

const router = express.Router();
router.use(requireAuth);

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post('/items/:itemId/upload', meter('manualParse'), upload.single('file'), async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.itemId, userId: { $in: req.scopeIds } });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // E2EE (Phase 4c): when the client encrypted the file, the uploaded bytes are
    // opaque ciphertext and it sends the wrapped per-file key + a client-minted
    // _id (so the wrapped key's AAD binds to this record). fileType is the
    // *plaintext* mimetype for the client to set on the decrypted blob.
    const encrypted = req.body.encrypted === 'true' || req.body.encrypted === true;
    const clientId = /^[a-f0-9]{24}$/i.test(req.body._id || '') ? req.body._id : undefined;

    const manual = await Manual.create({
      ...(clientId ? { _id: clientId } : {}),
      userId: req.user._id,
      itemId: item._id,
      title: req.body.title || req.file.originalname,
      source: 'uploaded',
      storageKey: req.file.filename,
      fileType: encrypted ? (req.body.fileType || 'application/pdf') : req.file.mimetype,
      fileSizeBytes: req.file.size,
      fetchedAt: new Date(),
      encrypted,
      ...(encrypted ? { wrappedFileKey: req.body.wrappedFileKey, keyVersion: Number(req.body.keyVersion) || undefined } : {}),
    });
    res.status(201).json(manual);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/items/:itemId/from-url', meter('manualParse'), async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.itemId, userId: { $in: req.scopeIds } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const contentType = response.headers['content-type'] || 'application/pdf';
    const ext = contentType.includes('pdf') ? '.pdf' : '.bin';
    const filename = `${Date.now()}-remote${ext}`;
    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, response.data);

    const manual = await Manual.create({
      userId: req.user._id,
      itemId: item._id,
      title: title || `Manual from URL`,
      source: 'manual-url',
      sourceUrl: url,
      storageKey: filename,
      fileType: contentType,
      fileSizeBytes: response.data.length,
      fetchedAt: new Date(),
    });
    res.status(201).json(manual);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/items/:itemId/auto-lookup', meter('manualParse'), async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.itemId, userId: { $in: req.scopeIds } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    let parts;
    if (item.type === 'vehicle') {
      const year = item.customFields?.find(f => f.key === 'Year')?.value || '';
      parts = [year, item.manufacturer, item.modelNumber];
    } else {
      parts = [item.manufacturer, item.modelNumber, item.name];
    }
    const terms = parts.filter(Boolean).join(' ').trim();

    console.log('[auto-lookup] searching:', { type: item.type, terms });

    if (!terms) {
      return res.status(400).json({ error: 'Item needs a manufacturer, model, or name to search' });
    }

    const candidates = await findManuals({ type: item.type, terms });
    console.log('[auto-lookup] found:', candidates.length, 'isFallback:', candidates[0]?.type === 'search-link');
    const isFallback = candidates.length > 0 && candidates[0].type === 'search-link';
    res.json({
      candidates,
      query: terms,
      isFallback,
    });
  } catch (err) {
    console.error('[auto-lookup] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const manual = await Manual.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!manual) return res.status(404).json({ error: 'Not found' });

    const filepath = path.join(uploadDir, manual.storageKey);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found on disk' });

    if (manual.encrypted) {
      // Opaque ciphertext — the client fetches, unwraps the file key, and decrypts.
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.sendFile(filepath);
    }
    res.setHeader('Content-Type', manual.fileType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${manual.title}.pdf"`);
    res.sendFile(filepath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parse a saved manual PDF and extract maintenance tasks via Claude
router.post('/:id/extract-tasks', meter('manualParse'), async (req, res) => {
  try {
    const manual = await Manual.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!manual) return res.status(404).json({ error: 'Manual not found' });
    if (manual.encrypted) {
      // The server can't read an encrypted manual; client-side extraction with
      // ephemeral consent is Phase 5.
      return res.status(400).json({ error: 'This manual is encrypted — task extraction from encrypted manuals is coming soon.' });
    }

    const filePath = path.join(uploadDir, manual.storageKey);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    const tasks = await parseManualForTasks(filePath);
    res.json({ tasks, manualTitle: manual.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create tasks that were extracted from a manual (called after user reviews and confirms)
router.post('/:id/create-tasks', async (req, res) => {
  try {
    const manual = await Manual.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!manual) return res.status(404).json({ error: 'Manual not found' });

    // currentKm is the vehicle's current odometer reading, used to seed nextDueKm/lastServiceKm
    const { tasks, itemId, categoryId, currentKm } = req.body;
    if (!Array.isArray(tasks) || !tasks.length) {
      return res.status(400).json({ error: 'tasks array is required' });
    }

    const created = await Promise.all(
      tasks.map(async t => {
        const task = new MaintenanceTask({
          userId: req.user._id,
          itemId: itemId || manual.itemId,
          categoryId: categoryId || undefined,
          title: t.title,
          description: [t.description, t.notes].filter(Boolean).join(' — '),
          priority: t.priority || 'medium',
          recurrence: t.recurrence?.type ? t.recurrence : undefined,
          estimatedDurationMins: t.estimatedDurationMins || undefined,
          estimatedCost: t.estimatedCost || undefined,
        });

        // Wire up mileage fields when Claude extracted an intervalKm
        if (t.intervalKm && currentKm != null) {
          const intervalKm = Number(t.intervalKm);
          task.intervalKm = intervalKm;
          // Next boundary above current odometer
          const intervals = Math.ceil(Number(currentKm) / intervalKm);
          task.nextDueKm = intervals * intervalKm;
          task.lastServiceKm = task.nextDueKm - intervalKm;
        } else if (t.intervalKm) {
          task.intervalKm = Number(t.intervalKm);
        }

        if (task.recurrence?.type) {
          task.nextDueDate = computeNextDueDate(task, new Date());
        }
        return task.save();
      })
    );

    res.status(201).json({ created: created.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream a remote URL through the server so the client can embed it in an iframe
// without being blocked by X-Frame-Options or CORS. Nothing is stored.
router.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Valid http/https url required' });
  }
  try {
    const upstream = await axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
      },
    });
    const contentType = upstream.headers['content-type'] || 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    // Strip upstream framing restrictions so our iframe can render it
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    upstream.data.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'Could not fetch URL: ' + err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const manual = await Manual.findOneAndDelete({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!manual) return res.status(404).json({ error: 'Not found' });

    const filepath = path.join(uploadDir, manual.storageKey);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
