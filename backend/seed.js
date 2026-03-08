'use strict';

/**
 * seed.js – Creates the default superadmin account.
 * Run: node seed.js
 * Reads ADMIN_EMAIL and ADMIN_PASSWORD from .env
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const db = require('./db/database');

const email    = process.env.ADMIN_EMAIL    || 'admin@tempmailpro.local';
const password = process.env.ADMIN_PASSWORD || 'Admin@1234!';

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.log(`✅  Admin user already exists: ${email} (id=${existing.id})`);
  process.exit(0);
}

const hash   = bcrypt.hashSync(password, 12);
const apiKey = uuidv4().replace(/-/g, '');

const result = db.prepare(
  `INSERT INTO users (email, password, role, api_key) VALUES (?, ?, 'superadmin', ?)`
).run(email, hash, apiKey);

console.log(`\n✅  Superadmin created:`);
console.log(`   Email:   ${email}`);
console.log(`   ID:      ${result.lastInsertRowid}`);
console.log(`   API Key: ${apiKey}`);
console.log(`\n⚠️   Change the password immediately after first login!\n`);
