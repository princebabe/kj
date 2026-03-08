'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'tempmailpro.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA foreign_keys=ON");

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    UNIQUE NOT NULL,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'user',
    status      TEXT    NOT NULL DEFAULT 'active',
    api_key     TEXT    UNIQUE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT
  );

  CREATE TABLE IF NOT EXISTS domains (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    UNIQUE NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    is_private  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS temp_emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    address     TEXT    UNIQUE NOT NULL,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    domain_id   INTEGER REFERENCES domains(id) ON DELETE CASCADE,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    temp_email_id INTEGER NOT NULL REFERENCES temp_emails(id) ON DELETE CASCADE,
    from_address  TEXT    NOT NULL,
    from_name     TEXT,
    subject       TEXT    NOT NULL DEFAULT '(no subject)',
    body_text     TEXT,
    body_html     TEXT,
    is_read       INTEGER NOT NULL DEFAULT 0,
    is_spam       INTEGER NOT NULL DEFAULT 0,
    received_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    mimetype    TEXT,
    size        INTEGER,
    path        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    description TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT    NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    detail      TEXT,
    ip          TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_temp_emails_address ON temp_emails(address);
  CREATE INDEX IF NOT EXISTS idx_temp_emails_user_id ON temp_emails(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_email_id   ON messages(temp_email_id);
  CREATE INDEX IF NOT EXISTS idx_audit_user          ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_action        ON audit_logs(action);
`);

// ─── Seed default data ────────────────────────────────────────────────────────
const defaultDomains = [
  'tempmail.pro','mailnull.com','sharklasers.com','spamgourmet.com',
  'guerrillamail.com','dispostable.com','yopmail.com','trashmail.com',
  'mailinator.com','throwam.com','tempr.email','getairmail.com',
];

try {
  db.exec('BEGIN');
  const insDomain = db.prepare('INSERT OR IGNORE INTO domains (name) VALUES (?)');
  defaultDomains.forEach(d => insDomain.run(d));

  const insSetting = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)`
  );
  insSetting.run('email_ttl_minutes',   '60',              'Default temp email TTL in minutes');
  insSetting.run('max_emails_per_user', '50',              'Max active temp emails per registered user');
  insSetting.run('max_message_size_kb', '2048',            'Max incoming message size in KB');
  insSetting.run('allow_registration',  'true',            'Allow new user registrations');
  insSetting.run('maintenance_mode',    'false',           'Put site into maintenance mode');
  insSetting.run('spam_filter_enabled', 'true',            'Enable spam filter');
  insSetting.run('site_name',           'TempMail Pro',    'Site display name');
  insSetting.run('contact_email',       'admin@tempmailpro.local', 'Contact email address');
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

// ─── Helper: run a function in a transaction ──────────────────────────────────
db.transaction = function(fn) {
  return function(...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
};

module.exports = db;
