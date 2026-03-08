'use strict';

const jwt  = require('jsonwebtoken');
const db   = require('../db/database');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

/**
 * Verify JWT from Authorization header (Bearer <token>).
 * Attaches decoded user to req.user.
 */
function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = jwt.verify(token, SECRET);
    const user    = db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').get(payload.id);

    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account suspended or banned' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require admin or superadmin role.
 */
function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Require superadmin role only.
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Super-admin access required' });
  }
  next();
}

/**
 * Write an audit log entry.
 */
function audit(db, userId, action, targetType, targetId, detail, ip) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId || null, action, targetType || null, String(targetId || ''), detail || null, ip || null);
}

module.exports = { authenticate, requireAdmin, requireSuperAdmin, audit };
