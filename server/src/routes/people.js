const express = require('express');
const multer  = require('multer');
const Person  = require('../models/Person');
const { requireAuth } = require('../middleware/auth');
const { isObjectId, pickRecordEnc } = require('../services/householdKey');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── vCard parser ───────────────────────────────────────────────────────────────
function parseVCards(raw) {
  // Unfold RFC 6350 folded lines (CRLF or LF + whitespace continuation)
  const content = raw.replace(/\r?\n[ \t]/g, '');

  const cardBlocks = content.split(/BEGIN:VCARD/i).slice(1);

  return cardBlocks.map(block => {
    function first(field) {
      const re = new RegExp(`^${field}(?:;[^:\\r\\n]*)?:([^\\r\\n]*)`, 'im');
      const m  = block.match(re);
      return m ? m[1].trim() : '';
    }
    function all(field) {
      const re = new RegExp(`^${field}(?:;[^:\\r\\n]*)?:([^\\r\\n]*)`, 'gim');
      const results = [];
      let m;
      while ((m = re.exec(block)) !== null) results.push(m[1].trim());
      return results;
    }

    // Name: prefer FN, fall back to assembling from N (family;given;additional;prefix;suffix)
    const fn = first('FN');
    const n  = first('N');
    let name = fn;
    if (!name && n) {
      const p = n.split(';').map(s => s.trim());
      name = [p[1], p[2], p[0]].filter(Boolean).join(' ').trim();
    }

    // Phone — first TEL value
    const phone = all('TEL')[0] ?? '';

    // Email — first EMAIL value
    const email = all('EMAIL')[0] ?? '';

    // Birthday — handle YYYYMMDD, YYYY-MM-DD, and --MMDD (no year)
    const bdayRaw = first('BDAY');
    let birthday = '';
    if (bdayRaw) {
      const digits = bdayRaw.replace(/\D/g, '');
      if (digits.length === 8) {
        birthday = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      } else if (/^\d{4}-\d{2}-\d{2}/.test(bdayRaw)) {
        birthday = bdayRaw.slice(0, 10);
      }
    }

    // Address — first ADR value, structured as pobox;ext;street;city;region;zip;country
    const adrRaw = first('ADR');
    let address = '';
    if (adrRaw) {
      const p = adrRaw.split(';').map(s => s.trim());
      address = [p[2], p[3], p[4], p[5], p[6]].filter(Boolean).join(', ');
    }

    // Notes
    const notes = first('NOTE');

    return { name, phone, email, birthday, address, notes };
  }).filter(c => c.name);
}

// ── CRUD ───────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Make sure the requesting member has a self-record in the roster.
    await Person.ensureSelf(req.user);
    const people = await Person.find({ userId: { $in: req.scopeIds } }).sort({ type: 1, name: 1 });
    res.json(people);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { type, name, relationship, birthday, interests, notes, address, phone, email } = req.body;
    let enc;
    try { enc = pickRecordEnc(req.body); }
    catch (msg) { return res.status(400).json({ error: msg }); }
    const person = await Person.create({
      ...(isObjectId(req.body._id) ? { _id: req.body._id } : {}),
      userId: req.user._id,
      type, name, relationship, birthday, interests, notes, address, phone, email,
      ...enc,
    });
    res.status(201).json(person);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await Person.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { type, name, relationship, birthday, interests, notes, address, phone, email } = req.body;
    const update = { name, relationship, birthday, interests, notes, address, phone, email };
    // Self-records always stay 'family'; everyone else can be re-typed freely.
    update.type = existing.accountId ? 'family' : type;
    try { Object.assign(update, pickRecordEnc(req.body)); }
    catch (msg) { return res.status(400).json({ error: msg }); }

    Object.assign(existing, update);
    await existing.save();
    res.json(existing);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const person = await Person.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!person) return res.status(404).json({ error: 'Not found' });
    if (person.accountId) return res.status(400).json({ error: 'You cannot remove your own profile card.' });
    await person.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Import ─────────────────────────────────────────────────────────────────────
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const content  = req.file.buffer.toString('utf-8');
    const contacts = parseVCards(content);
    if (!contacts.length) return res.status(422).json({ error: 'No contacts found in file' });
    res.json({ contacts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/bulk', async (req, res) => {
  try {
    const { people: incoming } = req.body;
    if (!Array.isArray(incoming) || !incoming.length) {
      return res.status(400).json({ error: 'people array is required' });
    }
    const docs = incoming.map(({ type, name, relationship, birthday, interests, notes, address, phone, email }) => ({
      userId: req.user._id,
      type, name, relationship, birthday: birthday || undefined, interests: interests || [],
      notes, address, phone, email,
    }));
    const created = await Person.insertMany(docs, { ordered: false });
    res.status(201).json({ created: created.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
