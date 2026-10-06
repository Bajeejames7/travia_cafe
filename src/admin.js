'use strict';
const { db } = require('./db');
const { hashPassword, randomChars } = require('./security');

/** Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if no admin exists yet. */
async function ensureAdmin() {
  if (await db.get("SELECT 1 AS x FROM staff WHERE role = 'admin'")) return;
  const email = String(process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || randomChars(14);
  await db.run("INSERT INTO staff (name, email, pass_hash, role) VALUES ('Admin', ?, ?, 'admin')", email, hashPassword(password));
  console.log('\n=== First admin account created ===');
  console.log(`Email:    ${email}`);
  console.log(`Password: ${process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : password}`);
  console.log('Change it after logging in.\n');
}

module.exports = { ensureAdmin };
