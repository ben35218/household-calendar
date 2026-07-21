const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Receipt = require('../models/Receipt');
const Item = require('../models/Item');
const { requireAuth } = require('../middleware/auth');

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
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // octet-stream = E2EE ciphertext upload (Phase 4c); the plaintext mimetype
    // rides in the body's fileType and the bytes are opaque to us either way.
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/heic', 'image/webp',
      'application/pdf', 'application/octet-stream',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

// Upload a receipt image for an item. Mirrors the manuals upload (incl. the
// Phase 4c E2EE ciphertext path): when the client encrypted the file it sends
// the opaque bytes plus a wrapped per-file key and a client-minted _id.
router.post('/items/:itemId/upload', upload.single('file'), async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.itemId, ...req.scopeFilter });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const encrypted = req.body.encrypted === 'true' || req.body.encrypted === true;
    const clientId = /^[a-f0-9]{24}$/i.test(req.body._id || '') ? req.body._id : undefined;

    const receipt = await Receipt.create({
      ...(clientId ? { _id: clientId } : {}),
      userId: req.user._id,
      itemId: item._id,
      title: req.body.title || req.file.originalname,
      storageKey: req.file.filename,
      fileType: encrypted ? (req.body.fileType || 'image/jpeg') : req.file.mimetype,
      fileSizeBytes: req.file.size,
      encrypted,
      ...(encrypted ? { wrappedFileKey: req.body.wrappedFileKey, keyVersion: Number(req.body.keyVersion) || undefined } : {}),
    });
    res.status(201).json(receipt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const receipt = await Receipt.findOne({ _id: req.params.id, ...req.scopeFilter });
    if (!receipt) return res.status(404).json({ error: 'Not found' });

    const filepath = path.join(uploadDir, receipt.storageKey);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found on disk' });

    if (receipt.encrypted) {
      // Opaque ciphertext — the client fetches, unwraps the file key, and decrypts.
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.sendFile(filepath);
    }
    res.setHeader('Content-Type', receipt.fileType || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${receipt.title}"`);
    res.sendFile(filepath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const receipt = await Receipt.findOneAndDelete({ _id: req.params.id, ...req.scopeFilter });
    if (!receipt) return res.status(404).json({ error: 'Not found' });
    if (receipt.storageKey) {
      const filepath = path.join(uploadDir, receipt.storageKey);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
