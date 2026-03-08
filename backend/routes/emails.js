'use strict';

const express  = require('express');
const { body, validationResult } = require('express-validator');
const db       = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { audit }        = require('../middleware/auth');
const { emailGen }     = require('../middleware/rateLimiter');

const router = express.Router();

const ADJECTIVES = ['swift','cool','bright','dark','bold','wild','lazy','happy','tiny','clever','fuzzy','zesty','proud','lucky','brave','quiet'];
const NOUNS      = ['fox','wolf','bear','hawk','lion','deer','raven','otter','seal','jade','panda','moose','tiger','crane','viper','eagle'];

function randomUser() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const d = Math.floor(Math.random() * 9999);
  return `${a}.${n}${d}`;
}

function pickDomain() {
  const domains = db.prepare(`SELECT id, name FROM domains WHERE is_active = 1`).all();
  if (!domains.length) return null;
  return domains[Math.floor(Math.random() * domains.length)];
}

function ttlMinutes() {
  const s = db.prepare(`SELECT value FROM settings WHERE key = 'email_ttl_minutes'`).get();
  return parseInt(s ? s.value : '60', 10);
}

// ─── POST /api/emails/generate ───────────────────────────────────────────────
router.post('/generate', emailGen, (req, res) => {
  const domain = pickDomain();
  if (!domain) return res.status(503).json({ error: 'No domains available' });

  const username = req.body.username
    ? req.body.username.toLowerCase().replace(/[^a-z0-9._-]/g, '')
    : randomUser();

  if (!username) return res.status(400).json({ error: 'Invalid username' });

  const address = `${username}@${domain.name}`;
  const ttl     = ttlMinutes();
  const userId  = req.user ? req.user.id : null;

  // Check for collision
  const existing = db.prepare(`SELECT id FROM temp_emails WHERE address = ? AND is_deleted = 0 AND expires_at > datetime('now')`).get(address);
  if (existing) {
    // Return the existing record instead of erroring
    const te = db.prepare(`SELECT * FROM temp_emails WHERE id = ?`).get(existing.id);
    return res.json({ temp_email: te });
  }

  const result = db.prepare(
    `INSERT INTO temp_emails (address, user_id, domain_id, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))` 
  ).run(address, userId, domain.id, `+${ttl} minutes`);

  const te = db.prepare('SELECT * FROM temp_emails WHERE id = ?').get(result.lastInsertRowid);
  audit(db, userId, 'generate_email', 'temp_email', te.id, address, req.ip);

  res.status(201).json({ temp_email: te });
});

// ─── GET /api/emails ──────────────────────────────────────────────────────────
router.get('/', authenticate, (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
  const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
  const offset = (page - 1) * limit;

  const emails = db.prepare(
    `SELECT te.*, d.name AS domain_name,
            COUNT(m.id) AS message_count
     FROM   temp_emails te
     JOIN   domains d ON d.id = te.domain_id
     LEFT JOIN messages m ON m.temp_email_id = te.id
     WHERE  te.user_id = ? AND te.is_deleted = 0
     GROUP  BY te.id
     ORDER  BY te.created_at DESC
     LIMIT  ? OFFSET ?`
  ).all(req.user.id, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM temp_emails WHERE user_id = ? AND is_deleted = 0`
  ).get(req.user.id).n;

  res.json({ emails, total, page, limit });
});

// ─── GET /api/emails/:id ──────────────────────────────────────────────────────
router.get('/:id', authenticate, (req, res) => {
  const te = db.prepare(
    `SELECT te.*, d.name AS domain_name FROM temp_emails te JOIN domains d ON d.id = te.domain_id WHERE te.id = ? AND te.user_id = ? AND te.is_deleted = 0`
  ).get(req.params.id, req.user.id);

  if (!te) return res.status(404).json({ error: 'Email not found' });
  res.json({ temp_email: te });
});

// ─── DELETE /api/emails/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticate, (req, res) => {
  const te = db.prepare(
    `SELECT id FROM temp_emails WHERE id = ? AND user_id = ? AND is_deleted = 0`
  ).get(req.params.id, req.user.id);

  if (!te) return res.status(404).json({ error: 'Email not found' });

  db.prepare(`UPDATE temp_emails SET is_deleted = 1 WHERE id = ?`).run(te.id);
  audit(db, req.user.id, 'delete_email', 'temp_email', te.id, null, req.ip);

  res.json({ message: 'Email deleted' });
});

// ─── GET /api/emails/lookup/:address ─────────────────────────────────────────
// Used internally / by SMTP hook to check if an address exists
router.get('/lookup/:address', (req, res) => {
  const te = db.prepare(
    `SELECT * FROM temp_emails WHERE address = ? AND is_deleted = 0 AND expires_at > datetime('now')`
  ).get(req.params.address.toLowerCase());

  if (!te) return res.status(404).json({ error: 'Address not found or expired' });
  res.json({ temp_email: te });
});

module.exports = router;
