const express = require('express');
const multer  = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const Person  = require('../models/Person');
const { requireAuth } = require('../middleware/auth');
const { meter, getConfig } = require('../middleware/usageMeter');
const { isObjectId, pickRecordEnc } = require('../services/householdKey');
const { plaintextCreateBlocked, E2EE_REQUIRED_MESSAGE } = require('../services/e2eePolicy');

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
    const { type, name, relationship, birthday, interests, notes, address, businessName, phone, email, deviceContactId } = req.body;
    let enc;
    try { enc = pickRecordEnc(req.body); }
    catch (msg) { return res.status(400).json({ error: msg }); }
    if (plaintextCreateBlocked(req.household, enc.enc)) {
      return res.status(400).json({ error: E2EE_REQUIRED_MESSAGE });
    }
    const person = await Person.create({
      ...(isObjectId(req.body._id) ? { _id: req.body._id } : {}),
      userId: req.user._id,
      type, name, relationship, birthday, interests, notes, address, businessName, phone, email, deviceContactId,
      ...enc,
    });
    res.status(201).json(person);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Client-driven self-Person seed. Post-drop the server can't create readable
// content, so ensureSelf stops creating a plaintext self-record (see Person.js);
// the client instead seeds an *encrypted* one and posts it here. Idempotent, and
// accountId/type are stamped server-side (never trusted from the client) so this
// is the undeletable "You" card. Mirrors POST / for the plaintext/enc columns.
router.post('/self', async (req, res) => {
  try {
    let self = await Person.findOne({ accountId: req.user._id });
    if (!self) {
      let enc;
      try { enc = pickRecordEnc(req.body); }
      catch (msg) { return res.status(400).json({ error: msg }); }
      if (plaintextCreateBlocked(req.household, enc.enc)) {
        return res.status(400).json({ error: E2EE_REQUIRED_MESSAGE });
      }
      const { name, relationship, birthday, interests, notes, address, phone, email } = req.body;
      self = await Person.create({
        ...(isObjectId(req.body._id) ? { _id: req.body._id } : {}),
        userId:    req.user._id,
        accountId: req.user._id,
        type:      'family',
        name, relationship, birthday, interests, notes, address, phone, email,
        ...enc,
      });
    }
    if (!req.user.personId || String(req.user.personId) !== String(self._id)) {
      await require('../models/User').updateOne({ _id: req.user._id }, { $set: { personId: self._id } });
    }
    res.status(201).json(self);
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
    const docs = incoming.map(({ type, name, relationship, birthday, interests, notes, address, businessName, phone, email, deviceContactId }) => ({
      userId: req.user._id,
      type, name, relationship, birthday: birthday || undefined, interests: interests || [],
      notes, address, businessName, phone, email, deviceContactId: deviceContactId || undefined,
    }));
    const created = await Person.insertMany(docs, { ordered: false });
    res.status(201).json({ created: created.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── AI-assisted import ─────────────────────────────────────────────────────────
// Given raw device contacts, categorize each (family / friend / service) and
// pre-populate the person form. Professionals additionally get a web-search
// lookup to fill business name / address / phone. Returns results aligned to the
// caller-supplied `key` so the client can map them back onto its rows.

const CLASSIFY_TOOL = {
  name: 'classify_contacts',
  description:
    'Categorize each contact and pre-fill its details from what is known. ' +
    'type: "family" for relatives, "friend" for personal acquaintances, ' +
    '"service" for businesses / professionals (plumber, dentist, salon, etc.). ' +
    'For "service" contacts set businessName (the company) and leave name as the ' +
    'point-of-contact if one is implied, otherwise reuse the business name.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Echo back the contact key unchanged.' },
            type: { type: 'string', enum: ['family', 'friend', 'service'] },
            name: { type: 'string' },
            relationship: { type: 'string', description: 'e.g. "sister", "neighbor", or the service (plumber, dentist).' },
            businessName: { type: 'string', description: 'Company name — service contacts only.' },
            address: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            interests: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string', description: 'Short helpful context, if any.' },
          },
          required: ['key', 'type', 'name'],
        },
      },
    },
    required: ['results'],
  },
};

const BUSINESS_DETAILS_TOOL = {
  name: 'business_details',
  description: 'Report the verified details found for the business.',
  input_schema: {
    type: 'object',
    properties: {
      businessName: { type: 'string' },
      address: { type: 'string', description: 'Full street address.' },
      phone: { type: 'string' },
      relationship: { type: 'string', description: 'What the business does (e.g. plumber, dentist).' },
      notes: { type: 'string', description: 'One short line, e.g. hours or website.' },
    },
  },
};

// Best-effort web lookup for one professional. Returns a patch object (may be
// empty). Never throws — enrichment is optional.
async function enrichProfessional(client, model, r) {
  try {
    const hint = [r.businessName || r.name, r.address, r.phone].filter(Boolean).join(', ');
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, BUSINESS_DETAILS_TOOL],
      system:
        'Look up this local business on the web and report verified contact details. ' +
        'Only report facts you find; do not guess. Call business_details once when done.',
      messages: [{ role: 'user', content: `Find contact details for this business: ${hint}` }],
    });
    const tu = resp.content.find((b) => b.type === 'tool_use' && b.name === 'business_details');
    if (!tu || !tu.input || typeof tu.input !== 'object') return {};
    const patch = {};
    for (const k of ['businessName', 'address', 'phone', 'relationship', 'notes']) {
      const v = tu.input[k];
      if (typeof v === 'string' && v.trim()) patch[k] = v.trim();
    }
    return patch;
  } catch {
    return {};
  }
}

router.post('/classify', meter('chat', 'contactImport'), async (req, res) => {
  try {
    const { contacts, enrich } = req.body || {};
    if (!Array.isArray(contacts) || !contacts.length) {
      return res.status(400).json({ error: 'contacts array is required' });
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });

    // Only pass through the fields we need, keyed for round-tripping.
    const clean = contacts.slice(0, 100).map((c, i) => ({
      key: String(c.key ?? i),
      name: String(c.name ?? '').slice(0, 200),
      phone: c.phone ? String(c.phone).slice(0, 60) : undefined,
      email: c.email ? String(c.email).slice(0, 120) : undefined,
      birthday: c.birthday ? String(c.birthday).slice(0, 10) : undefined,
      company: c.company ? String(c.company).slice(0, 200) : undefined,
    }));

    const config = await getConfig();
    // Sonnet on all tiers: every plan uses the paid chat model.
    const model = config.models.paidChat;
    const client = new Anthropic({ apiKey });

    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'tool', name: 'classify_contacts' },
      system:
        'You help a household sort imported phone contacts into Family, Friends, and ' +
        'Professionals (services/businesses), and pre-fill each contact form from the ' +
        'known details. Infer type from the name and company. Echo every contact back ' +
        'exactly once using its key. Do not invent details you were not given.',
      messages: [{ role: 'user', content: `Contacts (JSON):\n${JSON.stringify(clean, null, 2)}` }],
    });

    const toolUse = resp.content.find((b) => b.type === 'tool_use' && b.name === 'classify_contacts');
    const raw = Array.isArray(toolUse?.input?.results) ? toolUse.input.results : [];
    const byKey = new Map(clean.map((c) => [c.key, c]));
    const results = raw
      .filter((r) => r && byKey.has(String(r.key)))
      .map((r) => {
        const src = byKey.get(String(r.key));
        const type = ['family', 'friend', 'service'].includes(r.type) ? r.type : 'friend';
        return {
          key: String(r.key),
          type,
          name: (r.name || src.name || '').trim(),
          relationship: r.relationship?.trim() || undefined,
          businessName: type === 'service' ? r.businessName?.trim() || undefined : undefined,
          address: r.address?.trim() || undefined,
          phone: r.phone?.trim() || src.phone || undefined,
          email: r.email?.trim() || src.email || undefined,
          birthday: src.birthday || undefined,
          interests: Array.isArray(r.interests) ? r.interests.map((x) => String(x).trim()).filter(Boolean) : [],
          notes: r.notes?.trim() || undefined,
        };
      });

    // Web-search enrichment for professionals (best-effort, bounded + parallel).
    if (enrich !== false) {
      const pros = results.filter((r) => r.type === 'service').slice(0, 8);
      const patches = await Promise.all(pros.map((r) => enrichProfessional(client, model, r)));
      pros.forEach((r, i) => {
        const p = patches[i];
        if (p.businessName) r.businessName = p.businessName;
        if (p.address) r.address = p.address;
        if (p.phone) r.phone = p.phone;
        if (p.relationship && !r.relationship) r.relationship = p.relationship;
        if (p.notes && !r.notes) r.notes = p.notes;
      });
    }

    res.json({ results });
  } catch (err) {
    console.error('Contact classify error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
