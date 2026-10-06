'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const VIDEO_DIR = path.join(DATA_DIR, 'videos');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'travia.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
  id             INTEGER PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  sort           INTEGER NOT NULL DEFAULT 0,
  price_self     INTEGER NOT NULL,
  price_live     INTEGER NOT NULL,
  price_physical INTEGER NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS videos (
  id         INTEGER PRIMARY KEY,
  module_id  INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A scheduled live (online) or physical class for a module.
CREATE TABLE IF NOT EXISTS classes (
  id           INTEGER PRIMARY KEY,
  module_id    INTEGER NOT NULL REFERENCES modules(id),
  mode         TEXT NOT NULL CHECK (mode IN ('live', 'physical')),
  title        TEXT NOT NULL,
  starts_at    TEXT NOT NULL,            -- local Nairobi time, 'YYYY-MM-DDTHH:MM'
  duration_min INTEGER NOT NULL DEFAULT 60,
  location     TEXT NOT NULL DEFAULT '', -- physical classes
  meeting_link TEXT NOT NULL DEFAULT '', -- live classes; never shown publicly
  capacity     INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
  teacher_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS enrollments (
  id           INTEGER PRIMARY KEY,
  ref          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT NOT NULL,
  track        TEXT NOT NULL CHECK (track IN ('self', 'live', 'physical')),
  module_id    INTEGER NOT NULL REFERENCES modules(id),
  class_id     INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  amount       INTEGER NOT NULL,
  -- awaiting_payment -> pending_review -> confirmed | rejected
  status       TEXT NOT NULL DEFAULT 'awaiting_payment',
  mpesa_code   TEXT UNIQUE,
  paid_at      TEXT,
  reject_reason TEXT,
  code_hash    TEXT UNIQUE,              -- sha256 of the one-time access code
  code_used_at TEXT,
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  link_sent_at TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS enrollments_status ON enrollments(status);
CREATE INDEX IF NOT EXISTS enrollments_class ON enrollments(class_id);

CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone          TEXT NOT NULL DEFAULT '',
  pass_hash      TEXT,                   -- NULL for Google-only accounts
  google_sub     TEXT UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS student_sessions (
  token_hash TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL,              -- sent | logged | failed
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Migrations for databases created before student accounts existed.
const enrollmentCols = db.prepare('PRAGMA table_info(enrollments)').all().map((c) => c.name);
if (!enrollmentCols.includes('student_id')) {
  db.exec('ALTER TABLE enrollments ADD COLUMN student_id INTEGER REFERENCES students(id) ON DELETE SET NULL');
}
db.exec('CREATE INDEX IF NOT EXISTS enrollments_student ON enrollments(student_id); DROP TABLE IF EXISTS viewer_access;');

const DEFAULT_SETTINGS = {
  school_name: 'Travia Cafe',
  tagline: 'Practical cybersecurity training — self-paced, live online, or in person.',
  default_price_self: '1000',
  default_price_live: '1000',
  default_price_physical: '2500',
  mpesa_method: 'till', // till | paybill | phone
  mpesa_number: '',
  mpesa_account_name: '',
  contact_phone: '',
  contact_email: '',
  notify_email: '', // where "new payment to review" alerts go
};

const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertDefault.run(k, v);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function setSettings(values) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  tx(() => {
    for (const [k, v] of Object.entries(values)) stmt.run(k, String(v));
  });
}

module.exports = { db, DATA_DIR, VIDEO_DIR, DEFAULT_SETTINGS, tx, getSettings, setSettings };
