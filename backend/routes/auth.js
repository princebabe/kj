'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db/database');
const { audit } = require('../middleware/auth');
const { auth: authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
const SECRET  = process.env.JWT_SECRET || 'dev_secret_change_me';
const EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function issueToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: EXPIRES });
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const allowReg = db.prepare(`SELECT value FROM settings WHERE key = 'allow_registration'`).get();
    if (allowReg && allowReg.value === 'false') {
      return res.status(403).json({ error: 'Registrations are currently closed.' });
    }

    const { email, password } = req.body;
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const hash   = bcrypt.hashSync(password, 12);
    const apiKey = uuidv4().replace(/-/g, '');

    const result = db.prepare(
      `INSERT INTO users (email, password, api_key) VALUES (?, ?, ?)`
    ).run(email, hash, apiKey);

    const user = db.prepare('SELECT id, email, role, status, api_key, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    audit(db, user.id, 'register', 'user', user.id, null, req.ip);

    res.status(201).json({ token: issueToken(user), user });
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account suspended or banned' });
    }

    db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);
    audit(db, user.id, 'login', 'user', user.id, null, req.ip);

    const safe = { id: user.id, email: user.email, role: user.role, api_key: user.api_key, created_at: user.created_at };
    res.json({ token: issueToken(user), user: safe });
  }
);

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', require('../middleware/auth').authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, role, status, api_key, created_at, last_login FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
router.post('/change-password',
  require('../middleware/auth').authenticate,
  [
    body('current_password').notEmpty(),
    body('new_password').isLength({ min: 8 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(req.body.current_password, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = bcrypt.hashSync(req.body.new_password, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
    audit(db, user.id, 'change_password', 'user', user.id, null, req.ip);

    res.json({ message: 'Password changed successfully' });
  }
);

module.exports = router;
