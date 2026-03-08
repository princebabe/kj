'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db/database');
const { authenticate, requireAdmin, requireSuperAdmin, audit } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  const stats = {
    users: {
      total:    db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n,
      active:   db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'active'`).get().n,
      banned:   db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'banned'`).get().n,
      today:    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE date(created_at) = date('now')`).get().n,
    },
    emails: {
      total:   db.prepare(`SELECT COUNT(*) AS n FROM temp_emails`).get().n,
      active:  db.prepare(`SELECT COUNT(*) AS n FROM temp_emails WHERE is_deleted = 0 AND expires_at > datetime('now')`).get().n,
      expired: db.prepare(`SELECT COUNT(*) AS n FROM temp_emails WHERE expires_at <= datetime('now') OR is_deleted = 1`).get().n,
      today:   db.prepare(`SELECT COUNT(*) AS n FROM temp_emails WHERE date(created_at) = date('now')`).get().n,
    },
    messages: {
      total:  db.prepare(`SELECT COUNT(*) AS n FROM messages`).get().n,
      unread: db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE is_read = 0`).get().n,
      spam:   db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE is_spam = 1`).get().n,
      today:  db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE date(received_at) = date('now')`).get().n,
    },
    domains: {
      total:    db.prepare(`SELECT COUNT(*) AS n FROM domains`).get().n,
      active:   db.prepare(`SELECT COUNT(*) AS n FROM domains WHERE is_active = 1`).get().n,
      inactive: db.prepare(`SELECT COUNT(*) AS n FROM domains WHERE is_active = 0`).get().n,
    },
  };

  const recent_users = db.prepare(
    `SELECT id, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 5`
  ).all();

  const recent_emails = db.prepare(
    `SELECT te.address, te.created_at, te.expires_at, d.name AS domain, u.email AS owner
     FROM   temp_emails te
     JOIN   domains d ON d.id = te.domain_id
     LEFT JOIN users u ON u.id = te.user_id
     ORDER  BY te.created_at DESC LIMIT 10`
  ).all();

  const chart_daily = db.prepare(
    `SELECT date(created_at) AS day, COUNT(*) AS count
     FROM   temp_emails
     WHERE  created_at >= date('now', '-7 days')
     GROUP  BY day ORDER BY day`
  ).all();

  const chart_messages = db.prepare(
    `SELECT date(received_at) AS day, COUNT(*) AS count
     FROM   messages
     WHERE  received_at >= date('now', '-7 days')
     GROUP  BY day ORDER BY day`
  ).all();

  const recent_audit = db.prepare(
    `SELECT al.*, u.email AS user_email
     FROM   audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ORDER  BY al.created_at DESC LIMIT 10`
  ).all();

  res.json({ stats, recent_users, recent_emails, chart_daily, chart_messages, recent_audit });
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/users
router.get('/users', (req, res) => {
  const page    = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limit   = Math.min(100, parseInt(req.query.limit || '25', 10));
  const offset  = (page - 1) * limit;
  const search  = req.query.search ? `%${req.query.search}%` : '%';
  const status  = req.query.status || null;
  const role    = req.query.role   || null;

  let sql = `SELECT id, email, role, status, api_key, created_at, last_login FROM users WHERE email LIKE ?`;
  const params = [search];
  if (status) { sql += ` AND status = ?`; params.push(status); }
  if (role)   { sql += ` AND role = ?`;   params.push(role); }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const users = db.prepare(sql).all(...params);

  let countSql = `SELECT COUNT(*) AS n FROM users WHERE email LIKE ?`;
  const countParams = [search];
  if (status) { countSql += ` AND status = ?`; countParams.push(status); }
  if (role)   { countSql += ` AND role = ?`;   countParams.push(role); }
  const total = db.prepare(countSql).get(...countParams).n;

  res.json({ users, total, page, limit });
});

// GET /api/admin/users/:id
router.get('/users/:id', (req, res) => {
  const user = db.prepare(
    `SELECT id, email, role, status, api_key, created_at, last_login FROM users WHERE id = ?`
  ).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const emailCount = db.prepare(`SELECT COUNT(*) AS n FROM temp_emails WHERE user_id = ?`).get(req.params.id).n;
  const recent     = db.prepare(`SELECT action, created_at, detail FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`).all(req.params.id);

  res.json({ user, email_count: emailCount, recent_activity: recent });
});

// PATCH /api/admin/users/:id/status
router.patch('/users/:id/status',
  [body('status').isIn(['active','banned','suspended'])],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent demoting superadmin unless caller is superadmin
    if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Cannot modify superadmin' });
    }

    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(req.body.status, user.id);
    audit(db, req.user.id, 'update_user_status', 'user', user.id, req.body.status, req.ip);

    res.json({ message: 'Status updated' });
  }
);

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role',
  requireSuperAdmin,
  [body('role').isIn(['user','admin','superadmin'])],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, user.id);
    audit(db, req.user.id, 'update_user_role', 'user', user.id, req.body.role, req.ip);

    res.json({ message: 'Role updated' });
  }
);

// DELETE /api/admin/users/:id
router.delete('/users/:id', requireSuperAdmin, (req, res) => {
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  audit(db, req.user.id, 'delete_user', 'user', user.id, null, req.ip);
  res.json({ message: 'User deleted' });
});

// POST /api/admin/users – create user from admin panel
router.post('/users',
  requireSuperAdmin,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('role').optional().isIn(['user','admin','superadmin']),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password, role } = req.body;
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const hash   = bcrypt.hashSync(password, 12);
    const apiKey = uuidv4().replace(/-/g, '');
    const result = db.prepare(
      `INSERT INTO users (email, password, role, api_key) VALUES (?, ?, ?, ?)`
    ).run(email, hash, role || 'user', apiKey);

    audit(db, req.user.id, 'admin_create_user', 'user', result.lastInsertRowid, email, req.ip);
    res.status(201).json({ user_id: result.lastInsertRowid });
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEMP EMAIL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/emails
router.get('/emails', (req, res) => {
  const page    = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limit   = Math.min(100, parseInt(req.query.limit || '25', 10));
  const offset  = (page - 1) * limit;
  const search  = req.query.search ? `%${req.query.search}%` : '%';

  const emails = db.prepare(
    `SELECT te.id, te.address, te.expires_at, te.created_at, te.is_deleted,
            d.name AS domain, u.email AS owner,
            COUNT(m.id) AS message_count
     FROM   temp_emails te
     JOIN   domains d ON d.id = te.domain_id
     LEFT JOIN users u ON u.id = te.user_id
     LEFT JOIN messages m ON m.temp_email_id = te.id
     WHERE  te.address LIKE ?
     GROUP  BY te.id
     ORDER  BY te.created_at DESC
     LIMIT  ? OFFSET ?`
  ).all(search, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM temp_emails WHERE address LIKE ?`).get(search).n;

  res.json({ emails, total, page, limit });
});

// DELETE /api/admin/emails/:id
router.delete('/emails/:id', (req, res) => {
  const te = db.prepare('SELECT id, address FROM temp_emails WHERE id = ?').get(req.params.id);
  if (!te) return res.status(404).json({ error: 'Email not found' });

  db.prepare('UPDATE temp_emails SET is_deleted = 1 WHERE id = ?').run(te.id);
  audit(db, req.user.id, 'admin_delete_email', 'temp_email', te.id, te.address, req.ip);
  res.json({ message: 'Deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/messages
router.get('/messages', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limit  = Math.min(100, parseInt(req.query.limit || '25', 10));
  const offset = (page - 1) * limit;
  const spam   = req.query.spam !== undefined ? parseInt(req.query.spam, 10) : null;
  const search = req.query.search ? `%${req.query.search}%` : '%';

  let sql = `
    SELECT m.id, m.from_address, m.subject, m.is_read, m.is_spam, m.received_at,
           te.address AS inbox
    FROM   messages m
    JOIN   temp_emails te ON te.id = m.temp_email_id
    WHERE  (m.subject LIKE ? OR m.from_address LIKE ?)`;
  const params = [search, search];
  if (spam !== null) { sql += ` AND m.is_spam = ?`; params.push(spam); }
  sql += ` ORDER BY m.received_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const messages = db.prepare(sql).all(...params);
  const total    = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE subject LIKE ? OR from_address LIKE ?`).get(search, search).n;

  res.json({ messages, total, page, limit });
});

// DELETE /api/admin/messages/:id
router.delete('/messages/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  audit(db, req.user.id, 'admin_delete_message', 'message', req.params.id, null, req.ip);
  res.json({ message: 'Deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/domains
router.get('/domains', (req, res) => {
  const domains = db.prepare(
    `SELECT d.*, COUNT(te.id) AS email_count
     FROM   domains d
     LEFT JOIN temp_emails te ON te.domain_id = d.id AND te.is_deleted = 0
     GROUP  BY d.id
     ORDER  BY d.name`
  ).all();
  res.json({ domains });
});

// POST /api/admin/domains
router.post('/domains',
  [body('name').isString().notEmpty().trim()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const name = req.body.name.toLowerCase().trim();
    const exists = db.prepare('SELECT id FROM domains WHERE name = ?').get(name);
    if (exists) return res.status(409).json({ error: 'Domain already exists' });

    const result = db.prepare(
      `INSERT INTO domains (name, is_active, is_private) VALUES (?, ?, ?)`
    ).run(name, req.body.is_active ?? 1, req.body.is_private ?? 0);

    audit(db, req.user.id, 'add_domain', 'domain', result.lastInsertRowid, name, req.ip);
    res.status(201).json({ domain_id: result.lastInsertRowid });
  }
);

// PATCH /api/admin/domains/:id
router.patch('/domains/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM domains WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Domain not found' });

  const isActive  = req.body.is_active  !== undefined ? (req.body.is_active  ? 1 : 0) : d.is_active;
  const isPrivate = req.body.is_private !== undefined ? (req.body.is_private ? 1 : 0) : d.is_private;

  db.prepare('UPDATE domains SET is_active = ?, is_private = ? WHERE id = ?').run(isActive, isPrivate, d.id);
  audit(db, req.user.id, 'update_domain', 'domain', d.id, null, req.ip);
  res.json({ message: 'Domain updated' });
});

// DELETE /api/admin/domains/:id
router.delete('/domains/:id', requireSuperAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM domains WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Domain not found' });

  db.prepare('DELETE FROM domains WHERE id = ?').run(d.id);
  audit(db, req.user.id, 'delete_domain', 'domain', d.id, d.name, req.ip);
  res.json({ message: 'Domain deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings ORDER BY key').all();
  res.json({ settings });
});

// PUT /api/admin/settings
router.put('/settings', requireSuperAdmin, (req, res) => {
  const updates = req.body; // { key: value, ... }
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Invalid body' });

  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );

  const runAll = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) {
      upsert.run(k, String(v));
    }
  });
  runAll(updates);

  audit(db, req.user.id, 'update_settings', 'settings', null, JSON.stringify(updates), req.ip);
  res.json({ message: 'Settings updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/audit
router.get('/audit', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limit  = Math.min(200, parseInt(req.query.limit || '50', 10));
  const offset = (page - 1) * limit;
  const action = req.query.action ? `%${req.query.action}%` : '%';

  const logs = db.prepare(
    `SELECT al.*, u.email AS user_email
     FROM   audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE  al.action LIKE ?
     ORDER  BY al.created_at DESC
     LIMIT  ? OFFSET ?`
  ).all(action, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE ?`).get(action).n;

  res.json({ logs, total, page, limit });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BROADCAST (send notification email to all users – superadmin only)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/admin/broadcast
router.post('/broadcast', requireSuperAdmin,
  [body('subject').notEmpty(), body('message').notEmpty()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const users = db.prepare(`SELECT email FROM users WHERE status = 'active'`).all();
    // In production, you would iterate and send via nodemailer/SMTP
    audit(db, req.user.id, 'broadcast', 'all_users', null,
          `subject="${req.body.subject}" recipients=${users.length}`, req.ip);

    res.json({ message: `Broadcast queued for ${users.length} users`, recipients: users.length });
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM INFO
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/system', requireSuperAdmin, (req, res) => {
  res.json({
    node_version:  process.version,
    platform:      process.platform,
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb:     Math.round(process.memoryUsage().rss / 1024 / 1024),
    env:           process.env.NODE_ENV || 'development',
  });
});

module.exports = router;
