'use strict';

const express = require('express');
const db      = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── API Key middleware ───────────────────────────────────────────────────────
function apiKeyOrJwt(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const user = db.prepare('SELECT id, email, role, status FROM users WHERE api_key = ?').get(apiKey);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account inactive' });
    req.user = user;
    return next();
  }
  // Fall back to JWT
  return authenticate(req, res, next);
}

// ─── GET /api/v1/info ─────────────────────────────────────────────────────────
router.get('/info', (req, res) => {
  res.json({
    name:    'TempMail Pro API',
    version: '1.0.0',
    docs:    'https://tempmailpro.example.com/api-docs',
  });
});

// ─── GET /api/v1/domains ──────────────────────────────────────────────────────
router.get('/domains', (req, res) => {
  const domains = db.prepare(`SELECT name FROM domains WHERE is_active = 1 AND is_private = 0 ORDER BY name`).all();
  res.json({ domains: domains.map(d => d.name) });
});

// ─── POST /api/v1/email/generate ─────────────────────────────────────────────
router.post('/email/generate', apiKeyOrJwt, (req, res) => {
  const domains = db.prepare(`SELECT id, name FROM domains WHERE is_active = 1`).all();
  if (!domains.length) return res.status(503).json({ error: 'No domains available' });

  const domain   = req.body.domain
    ? domains.find(d => d.name === req.body.domain) || domains[0]
    : domains[Math.floor(Math.random() * domains.length)];

  const username = (req.body.username || `api.${Date.now()}`).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const address  = `${username}@${domain.name}`;
  const ttl      = parseInt(req.body.ttl_minutes || '60', 10);

  const result = db.prepare(
    `INSERT OR IGNORE INTO temp_emails (address, user_id, domain_id, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`
  ).run(address, req.user.id, domain.id, `+${ttl} minutes`);

  const te = result.lastInsertRowid
    ? db.prepare('SELECT * FROM temp_emails WHERE id = ?').get(result.lastInsertRowid)
    : db.prepare(`SELECT * FROM temp_emails WHERE address = ? AND is_deleted = 0`).get(address);

  res.status(result.lastInsertRowid ? 201 : 200).json({ temp_email: te });
});

// ─── GET /api/v1/inbox/:address ──────────────────────────────────────────────
router.get('/inbox/:address', apiKeyOrJwt, (req, res) => {
  const te = db.prepare(
    `SELECT id FROM temp_emails WHERE address = ? AND user_id = ? AND is_deleted = 0`
  ).get(req.params.address.toLowerCase(), req.user.id);

  if (!te) return res.status(404).json({ error: 'Inbox not found or not owned by you' });

  const messages = db.prepare(
    `SELECT id, from_address, from_name, subject, is_read, is_spam, received_at
     FROM   messages WHERE temp_email_id = ? ORDER BY received_at DESC LIMIT 50`
  ).all(te.id);

  res.json({ address: req.params.address, messages });
});

// ─── GET /api/v1/inbox/:address/message/:msgId ───────────────────────────────
router.get('/inbox/:address/message/:msgId', apiKeyOrJwt, (req, res) => {
  const te = db.prepare(
    `SELECT id FROM temp_emails WHERE address = ? AND user_id = ? AND is_deleted = 0`
  ).get(req.params.address.toLowerCase(), req.user.id);
  if (!te) return res.status(404).json({ error: 'Inbox not found' });

  const msg = db.prepare(
    `SELECT * FROM messages WHERE id = ? AND temp_email_id = ?`
  ).get(req.params.msgId, te.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(msg.id);
  res.json({ message: msg });
});

// ─── DELETE /api/v1/inbox/:address ───────────────────────────────────────────
router.delete('/inbox/:address', apiKeyOrJwt, (req, res) => {
  const te = db.prepare(
    `SELECT id FROM temp_emails WHERE address = ? AND user_id = ? AND is_deleted = 0`
  ).get(req.params.address.toLowerCase(), req.user.id);
  if (!te) return res.status(404).json({ error: 'Inbox not found' });

  db.prepare('UPDATE temp_emails SET is_deleted = 1 WHERE id = ?').run(te.id);
  res.json({ message: 'Inbox deleted' });
});

module.exports = router;
