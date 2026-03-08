'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const db       = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { audit }        = require('../middleware/auth');

const router = express.Router();

// ─── Helper: resolve temp_email_id by address (public, no auth) ──────────────
function resolveEmailId(address) {
  const te = db.prepare(
    `SELECT id FROM temp_emails WHERE address = ? AND is_deleted = 0 AND expires_at > datetime('now')`
  ).get(address.toLowerCase());
  return te ? te.id : null;
}

// ─── GET /api/inbox/:address ──────────────────────────────────────────────────
// Public – anyone who knows the address can read (disposable model)
router.get('/:address', (req, res) => {
  const emailId = resolveEmailId(req.params.address);
  if (!emailId) return res.status(404).json({ error: 'Inbox not found or expired' });

  const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limit  = Math.min(100, parseInt(req.query.limit || '50', 10));
  const offset = (page - 1) * limit;
  const spam   = req.query.spam === '1' ? 1 : 0;

  const messages = db.prepare(
    `SELECT id, from_address, from_name, subject, body_text,
            is_read, is_spam, received_at
     FROM   messages
     WHERE  temp_email_id = ? AND is_spam = ?
     ORDER  BY received_at DESC
     LIMIT  ? OFFSET ?`
  ).all(emailId, spam, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE temp_email_id = ? AND is_spam = ?`
  ).get(emailId, spam).n;

  res.json({ messages, total, page, limit });
});

// ─── GET /api/inbox/:address/:msgId ──────────────────────────────────────────
router.get('/:address/:msgId', (req, res) => {
  const emailId = resolveEmailId(req.params.address);
  if (!emailId) return res.status(404).json({ error: 'Inbox not found or expired' });

  const msg = db.prepare(
    `SELECT m.*, GROUP_CONCAT(a.id || '|' || a.filename || '|' || a.size) AS attachments
     FROM   messages m
     LEFT JOIN attachments a ON a.message_id = m.id
     WHERE  m.id = ? AND m.temp_email_id = ?
     GROUP  BY m.id`
  ).get(req.params.msgId, emailId);

  if (!msg) return res.status(404).json({ error: 'Message not found' });

  // Mark as read
  if (!msg.is_read) {
    db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(msg.id);
    msg.is_read = 1;
  }

  // Parse attachment list
  msg.attachment_list = msg.attachments
    ? msg.attachments.split(',').map(a => {
        const [id, filename, size] = a.split('|');
        return { id, filename, size: parseInt(size || '0', 10) };
      })
    : [];
  delete msg.attachments;

  res.json({ message: msg });
});

// ─── DELETE /api/inbox/:address/:msgId ───────────────────────────────────────
router.delete('/:address/:msgId', (req, res) => {
  const emailId = resolveEmailId(req.params.address);
  if (!emailId) return res.status(404).json({ error: 'Inbox not found' });

  const msg = db.prepare(
    `SELECT id FROM messages WHERE id = ? AND temp_email_id = ?`
  ).get(req.params.msgId, emailId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
  res.json({ message: 'Deleted' });
});

// ─── POST /api/inbox/receive ──────────────────────────────────────────────────
// Called by SMTP hook / mail server when a new email arrives
router.post('/receive', (req, res) => {
  // Simple shared secret to prevent unauthorized injection
  const secret = req.headers['x-webhook-secret'];
  if (secret !== (process.env.WEBHOOK_SECRET || 'webhook_secret_dev')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { to, from, from_name, subject, body_text, body_html } = req.body;
  if (!to || !from) return res.status(400).json({ error: 'Missing required fields' });

  const emailId = resolveEmailId(to);
  if (!emailId) return res.status(404).json({ error: 'Recipient inbox not found or expired' });

  // Simple spam heuristics
  const spamKeywords = ['win a prize', 'click here to claim', 'congratulations you won', 'nigerian prince'];
  const isSpam = spamKeywords.some(k => (subject || '').toLowerCase().includes(k) || (body_text || '').toLowerCase().includes(k)) ? 1 : 0;

  const result = db.prepare(
    `INSERT INTO messages (temp_email_id, from_address, from_name, subject, body_text, body_html, is_spam)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(emailId, from, from_name || null, subject || '(no subject)', body_text || null, body_html || null, isSpam);

  res.status(201).json({ message_id: result.lastInsertRowid });
});

// ─── GET /api/inbox/:address/attachment/:attachId ────────────────────────────
router.get('/:address/attachment/:attachId', (req, res) => {
  const emailId = resolveEmailId(req.params.address);
  if (!emailId) return res.status(404).json({ error: 'Inbox not found' });

  const att = db.prepare(
    `SELECT a.* FROM attachments a
     JOIN messages m ON m.id = a.message_id
     WHERE  a.id = ? AND m.temp_email_id = ?`
  ).get(req.params.attachId, emailId);

  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  const filePath = path.join(__dirname, '..', att.path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
  res.setHeader('Content-Type', att.mimetype || 'application/octet-stream');
  res.sendFile(filePath);
});

module.exports = router;
