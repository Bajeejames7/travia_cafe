'use strict';
try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the real environment
}

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { db, VIDEO_DIR, tx, getSettings, setSettings } = require('./src/db');
const { sendMail, mailConfigured } = require('./src/mail');
const emails = require('./src/emails');
const {
  sha256,
  randomToken,
  randomChars,
  hashPassword,
  verifyPassword,
  newAccessCode,
  normalizeCode,
  parseCookies,
  setCookie,
  rateLimit,
  securityHeaders,
  requireAppHeader,
} = require('./src/security');

const PORT = Number(process.env.PORT) || 3000;
// The staff dashboard lives at a path you choose, so it is not even discoverable.
const STAFF_PATH = '/' + String(process.env.STAFF_PATH || 'staff').replace(/^\/+|\/+$/g, '');
const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB) || 2048;
const STAFF_SESSION_MS = 12 * 60 * 60 * 1000;

const TRACKS = ['self', 'live', 'physical'];
const PRICE_COL = { self: 'price_self', live: 'price_live', physical: 'price_physical' };

// ---------------------------------------------------------------------------
// Bootstrap the first admin account
// ---------------------------------------------------------------------------
if (!db.prepare("SELECT 1 FROM staff WHERE role = 'admin'").get()) {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || randomChars(14);
  db.prepare("INSERT INTO staff (name, email, pass_hash, role) VALUES ('Admin', ?, ?, 'admin')").run(email, hashPassword(password));
  console.log('\n=== First admin account created ===');
  console.log(`Email:    ${email}`);
  console.log(`Password: ${process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : password}`);
  console.log('Change it after logging in.\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

function text(v, max, { required = false, label = 'Field' } = {}) {
  const s = String(v ?? '').trim().slice(0, max);
  if (required && !s) throw bad(`${label} is required.`);
  return s;
}
function int(v, { min = 0, max = 10_000_000, label = 'Number' } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}.`);
  return n;
}
function optionalId(v) {
  return v === undefined || v === null || v === '' ? null : int(v, { min: 1, label: 'ID' });
}
function email(v) {
  const s = text(v, 200, { required: true, label: 'Email' }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Enter a valid email address.');
  return s;
}
function phone(v) {
  const digits = String(v ?? '').replace(/[^\d+]/g, '');
  const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(digits);
  if (!m) throw bad('Enter a valid Safaricom number, e.g. 0712 345 678.');
  return `254${m[1]}`;
}
function httpsUrl(v) {
  const s = text(v, 500);
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') throw new Error();
    return u.toString();
  } catch {
    throw bad('Meeting link must be a full https:// address.');
  }
}
function startsAt(v) {
  const s = text(v, 16, { required: true, label: 'Start time' });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) throw bad('Start time must look like 2026-10-20T18:00.');
  return s;
}

/** Current time in Nairobi (UTC+3, no DST) in the same format as classes.starts_at. */
function nowNairobi() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16);
}
const nowIso = () => new Date().toISOString();

function baseUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function newRef() {
  for (;;) {
    const ref = `TC${randomChars(6)}`;
    if (!db.prepare('SELECT 1 FROM enrollments WHERE ref = ?').get(ref)) return ref;
  }
}

const getModule = (id) => db.prepare('SELECT * FROM modules WHERE id = ?').get(id);
const getClass = (id) => (id ? db.prepare('SELECT * FROM classes WHERE id = ?').get(id) : null);
const getEnrollment = (id) => db.prepare('SELECT * FROM enrollments WHERE id = ?').get(id);

/** Paid or under-review seats, plus unpaid ones for 24h so nobody can block a class by never paying. */
function seatsTaken(classId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM enrollments WHERE class_id = ? AND (status IN ('pending_review', 'confirmed')
          OR (status = 'awaiting_payment' AND created_at > datetime('now', '-1 day')))`
    )
    .get(classId).n;
}

function deleteVideoFile(filename) {
  fs.rm(path.join(VIDEO_DIR, path.basename(filename)), { force: true }, () => {});
}

/** Streams a video with HTTP Range support so the player can seek. */
function streamVideo(req, res, video) {
  const file = path.join(VIDEO_DIR, path.basename(video.filename));
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return res.status(404).json({ error: 'Video file is missing.' });
  }
  const headers = {
    'Content-Type': video.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range || (range[1] === '' && range[2] === '')) {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    return fs.createReadStream(file).pipe(res);
  }
  let start;
  let end;
  if (range[1] === '') {
    start = Math.max(stat.size - Number(range[2]), 0);
    end = stat.size - 1;
  } else {
    start = Number(range[1]);
    end = range[2] === '' ? stat.size - 1 : Math.min(Number(range[2]), stat.size - 1);
  }
  if (start > end || start >= stat.size) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    return res.end();
  }
  res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.use(securityHeaders);
app.use(express.json({ limit: '100kb' }));
app.use('/api', requireAppHeader);

// Wrap route handlers so thrown HttpErrors and async rejections reach the error handler.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ------------------------------- Public ------------------------------------

app.get(
  '/api/public/catalog',
  h((req, res) => {
    const s = getSettings();
    const modules = db
      .prepare(
        `SELECT m.id, m.title, m.description, m.price_self, m.price_live, m.price_physical,
                (SELECT COUNT(*) FROM videos v WHERE v.module_id = m.id) AS video_count
           FROM modules m WHERE m.active = 1 ORDER BY m.sort, m.id`
      )
      .all();
    const classes = db
      .prepare(
        `SELECT c.id, c.module_id, c.mode, c.title, c.starts_at, c.duration_min, c.location, c.capacity
           FROM classes c JOIN modules m ON m.id = c.module_id
          WHERE m.active = 1 AND c.starts_at >= ? ORDER BY c.starts_at`
      )
      .all(nowNairobi())
      .map((c) => ({
        id: c.id,
        module_id: c.module_id,
        mode: c.mode,
        title: c.title,
        starts_at: c.starts_at,
        duration_min: c.duration_min,
        location: c.mode === 'physical' ? c.location : '',
        full: c.capacity > 0 && seatsTaken(c.id) >= c.capacity,
      }));
    res.json({
      school: { name: s.school_name, tagline: s.tagline, contact_phone: s.contact_phone, contact_email: s.contact_email },
      prices: { self: +s.default_price_self, live: +s.default_price_live, physical: +s.default_price_physical },
      payment: { method: s.mpesa_method, number: s.mpesa_number, account_name: s.mpesa_account_name },
      modules,
      classes,
    });
  })
);

// ------------------------------- Student accounts --------------------------

const MAX_STUDENT_DEVICES = Number(process.env.MAX_STUDENT_DEVICES) || 2;
const STUDENT_SESSION_MS = 60 * 24 * 60 * 60 * 1000;
const GOOGLE =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET }
    : null;

const authLimit = rateLimit(20, 15 * 60 * 1000);
const enrollLimit = rateLimit(30, 15 * 60 * 1000);

function newPassword(v) {
  const s = String(v ?? '');
  if (s.length < 8) throw bad('Password must be at least 8 characters.');
  if (s.length > 200) throw bad('Password is too long.');
  return s;
}

/**
 * Starts a student session. Only the newest MAX_STUDENT_DEVICES sessions are kept, so an
 * account shared with friends keeps logging the others out.
 */
function startStudentSession(req, res, studentId) {
  const token = randomToken();
  const now = Date.now();
  tx(() => {
    db.prepare('DELETE FROM student_sessions WHERE expires_at < ?').run(now);
    db.prepare('INSERT INTO student_sessions (token_hash, student_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)').run(
      sha256(token),
      studentId,
      now + STUDENT_SESSION_MS,
      now,
      String(req.get('user-agent') || '').slice(0, 200)
    );
    db.prepare(
      `DELETE FROM student_sessions WHERE student_id = ? AND token_hash NOT IN
         (SELECT token_hash FROM student_sessions WHERE student_id = ? ORDER BY created_at DESC LIMIT ?)`
    ).run(studentId, studentId, MAX_STUDENT_DEVICES);
    db.prepare('UPDATE students SET last_login_at = ? WHERE id = ?').run(nowIso(), studentId);
  });
  setCookie(res, 'tc_student', token, { maxAgeSec: STUDENT_SESSION_MS / 1000, sameSite: 'Lax' });
}

function studentAuth(req, res, next) {
  const token = parseCookies(req).tc_student;
  const student =
    token &&
    db
      .prepare(
        `SELECT s.* FROM student_sessions ss JOIN students s ON s.id = ss.student_id
          WHERE ss.token_hash = ? AND ss.expires_at > ? AND s.active = 1`
      )
      .get(sha256(token), Date.now());
  if (!student) return res.status(401).json({ error: 'Please log in.' });
  req.student = student;
  next();
}

/** Attaches registrations made before the account existed. Only call when we know the student owns the email. */
function claimEnrollmentsByEmail(student) {
  db.prepare('UPDATE enrollments SET student_id = ? WHERE student_id IS NULL AND email = ?').run(student.id, student.email.toLowerCase());
}

/** Only allow same-site relative paths as a post-login destination. */
function safeNext(v) {
  const s = String(v || '');
  return /^\/(?![/\\])[\w\-/#?=&.]*$/.test(s) ? s : '/account';
}

app.get('/api/auth/config', (req, res) => res.json({ google: Boolean(GOOGLE) }));

app.post(
  '/api/auth/signup',
  authLimit,
  h((req, res) => {
    const b = req.body || {};
    const name = text(b.name, 100, { required: true, label: 'Name' });
    const mail = email(b.email);
    const pw = newPassword(b.password);
    if (db.prepare('SELECT 1 FROM students WHERE email = ?').get(mail)) {
      throw new HttpError(409, 'An account with that email already exists. Log in instead.');
    }
    const r = db.prepare('INSERT INTO students (name, email, pass_hash) VALUES (?, ?, ?)').run(name, mail, hashPassword(pw));
    startStudentSession(req, res, Number(r.lastInsertRowid));
    res.json({ ok: true });
  })
);

app.post(
  '/api/auth/login',
  authLimit,
  h((req, res) => {
    const s = db.prepare('SELECT * FROM students WHERE email = ?').get(String(req.body?.email || '').trim().toLowerCase());
    if (s && !s.pass_hash && s.google_sub) {
      throw new HttpError(401, 'This account signs in with Google. Use "Continue with Google".');
    }
    if (!s || !s.pass_hash || !verifyPassword(String(req.body?.password || ''), s.pass_hash)) {
      throw new HttpError(401, 'Wrong email or password.');
    }
    if (!s.active) throw new HttpError(403, 'This account has been disabled. Please contact us.');
    startStudentSession(req, res, s.id);
    res.json({ ok: true });
  })
);

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).tc_student;
  if (token) db.prepare('DELETE FROM student_sessions WHERE token_hash = ?').run(sha256(token));
  setCookie(res, 'tc_student', '', { maxAgeSec: 0, sameSite: 'Lax' });
  res.json({ ok: true });
});

app.post(
  '/api/auth/forgot',
  authLimit,
  h(async (req, res) => {
    const s = db.prepare('SELECT * FROM students WHERE email = ? AND active = 1').get(email(req.body?.email));
    if (s) {
      const token = randomToken();
      db.prepare('DELETE FROM password_resets WHERE student_id = ? OR expires_at < ?').run(s.id, Date.now());
      db.prepare('INSERT INTO password_resets (token_hash, student_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), s.id, Date.now() + 3600 * 1000);
      await sendMail({
        to: s.email,
        ...emails.passwordReset({ name: s.name, link: `${baseUrl(req)}/login?reset=${token}`, settings: getSettings() }),
      });
    }
    // Same answer whether or not the account exists, so nobody can probe for emails.
    res.json({ ok: true });
  })
);

app.post(
  '/api/auth/reset',
  authLimit,
  h((req, res) => {
    const row = db
      .prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?')
      .get(sha256(String(req.body?.token || '')), Date.now());
    if (!row) throw bad('This reset link has expired or was already used. Ask for a new one.');
    const pw = newPassword(req.body?.password);
    tx(() => {
      // Receiving the email proves the student owns the address.
      db.prepare('UPDATE students SET pass_hash = ?, email_verified = 1 WHERE id = ?').run(hashPassword(pw), row.student_id);
      db.prepare('DELETE FROM password_resets WHERE student_id = ?').run(row.student_id);
      db.prepare('DELETE FROM student_sessions WHERE student_id = ?').run(row.student_id);
    });
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(row.student_id);
    if (!s.active) throw new HttpError(403, 'This account has been disabled. Please contact us.');
    claimEnrollmentsByEmail(s);
    startStudentSession(req, res, s.id);
    res.json({ ok: true });
  })
);

// Google sign-in (OAuth 2.0 authorization code flow).
app.get('/auth/google', (req, res) => {
  if (!GOOGLE) return res.redirect('/login?error=google_off');
  const state = randomToken();
  setCookie(res, 'tc_oauth', `${state}|${safeNext(req.query.next)}`, { maxAgeSec: 600, sameSite: 'Lax' });
  const params = new URLSearchParams({
    client_id: GOOGLE.id,
    redirect_uri: `${baseUrl(req)}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get(
  '/auth/google/callback',
  h(async (req, res) => {
    const [state, next] = String(parseCookies(req).tc_oauth || '').split('|');
    setCookie(res, 'tc_oauth', '', { maxAgeSec: 0, sameSite: 'Lax' });
    const fail = (code) => res.redirect(`/login?error=${code}`);
    if (!GOOGLE) return fail('google_off');
    if (!state || req.query.state !== state || !req.query.code) return fail('google_failed');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: GOOGLE.id,
        client_secret: GOOGLE.secret,
        redirect_uri: `${baseUrl(req)}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail('google_failed');
    const { access_token: accessToken } = await tokenRes.json();
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!infoRes.ok) return fail('google_failed');
    const g = await infoRes.json();
    if (!g.sub || !g.email || !g.email_verified) return fail('google_unverified');
    const mail = String(g.email).toLowerCase();

    let s = db.prepare('SELECT * FROM students WHERE google_sub = ?').get(g.sub);
    if (!s) {
      const existing = db.prepare('SELECT * FROM students WHERE email = ?').get(mail);
      if (existing) {
        // Google has proven this person owns the email. If the password account was never verified,
        // someone else may have registered it, so drop that password and sign out its sessions.
        tx(() => {
          db.prepare(
            'UPDATE students SET google_sub = ?, pass_hash = CASE WHEN email_verified = 1 THEN pass_hash ELSE NULL END, email_verified = 1 WHERE id = ?'
          ).run(g.sub, existing.id);
          if (!existing.email_verified) db.prepare('DELETE FROM student_sessions WHERE student_id = ?').run(existing.id);
        });
        s = db.prepare('SELECT * FROM students WHERE id = ?').get(existing.id);
      } else {
        const name = String(g.name || mail.split('@')[0]).slice(0, 100);
        const r = db.prepare('INSERT INTO students (name, email, google_sub, email_verified) VALUES (?, ?, ?, 1)').run(name, mail, g.sub);
        s = db.prepare('SELECT * FROM students WHERE id = ?').get(Number(r.lastInsertRowid));
      }
    }
    if (!s.active) return fail('disabled');
    claimEnrollmentsByEmail(s);
    startStudentSession(req, res, s.id);
    res.redirect(safeNext(next));
  })
);

// ------------------------------- Student dashboard -------------------------

function libraryModuleIds(studentId) {
  return db
    .prepare(
      `SELECT DISTINCT module_id FROM enrollments
        WHERE student_id = ? AND track = 'self' AND status = 'confirmed' AND code_used_at IS NOT NULL`
    )
    .all(studentId)
    .map((r) => r.module_id);
}

app.post(
  '/api/enroll',
  enrollLimit,
  studentAuth,
  h((req, res) => {
    const b = req.body || {};
    const s = req.student;
    const track = String(b.track);
    if (!TRACKS.includes(track)) throw bad('Choose how you want to learn.');
    const tel = phone(b.phone || s.phone);
    const mod = getModule(optionalId(b.module_id));
    if (!mod || !mod.active) throw bad('Choose a module.');

    let classId = null;
    if (track !== 'self') {
      classId = optionalId(b.class_id);
      if (classId) {
        const cls = getClass(classId);
        if (!cls || cls.module_id !== mod.id || cls.mode !== track || cls.starts_at < nowNairobi()) {
          throw bad('That class is no longer available. Pick another date.');
        }
        if (cls.capacity > 0 && seatsTaken(cls.id) >= cls.capacity) throw bad('That class is full. Pick another date.');
      }
    }

    const ref = newRef();
    const amount = mod[PRICE_COL[track]];
    tx(() => {
      db.prepare(
        `INSERT INTO enrollments (ref, name, email, phone, track, module_id, class_id, amount, student_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(ref, s.name, s.email.toLowerCase(), tel, track, mod.id, classId, amount, s.id);
      if (tel !== s.phone) db.prepare('UPDATE students SET phone = ? WHERE id = ?').run(tel, s.id);
    });
    res.json({ ref, amount, track, module: mod.title });
  })
);

app.use('/api/me', studentAuth);

app.get('/api/me', (req, res) => {
  const s = req.student;
  const enrollments = db
    .prepare(
      `SELECT e.ref, e.track, e.amount, e.status, e.mpesa_code, e.reject_reason, e.code_used_at, e.created_at,
              m.title AS module_title, c.title AS class_title, c.starts_at, c.duration_min, c.location, c.meeting_link
         FROM enrollments e JOIN modules m ON m.id = e.module_id LEFT JOIN classes c ON c.id = e.class_id
        WHERE e.student_id = ? ORDER BY e.created_at DESC`
    )
    .all(s.id)
    .map((e) => ({ ...e, meeting_link: e.status === 'confirmed' && e.track === 'live' ? e.meeting_link || '' : '' }));
  const library = libraryModuleIds(s.id)
    .map(getModule)
    .filter(Boolean)
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      videos: db.prepare('SELECT id, title FROM videos WHERE module_id = ? ORDER BY sort, id').all(m.id),
    }));
  const st = getSettings();
  res.json({
    student: { name: s.name, email: s.email, phone: s.phone, google: Boolean(s.google_sub), has_password: Boolean(s.pass_hash) },
    enrollments,
    library,
    max_devices: MAX_STUDENT_DEVICES,
    payment: { method: st.mpesa_method, number: st.mpesa_number, account_name: st.mpesa_account_name },
  });
});

app.put(
  '/api/me',
  h((req, res) => {
    const name = text(req.body?.name, 100, { required: true, label: 'Name' });
    const tel = req.body?.phone ? phone(req.body.phone) : '';
    db.prepare('UPDATE students SET name = ?, phone = ? WHERE id = ?').run(name, tel, req.student.id);
    res.json({ ok: true });
  })
);

app.post(
  '/api/me/password',
  h((req, res) => {
    const s = req.student;
    if (s.pass_hash && !verifyPassword(String(req.body?.current || ''), s.pass_hash)) throw bad('Current password is wrong.');
    const pw = newPassword(req.body?.next);
    db.prepare('UPDATE students SET pass_hash = ? WHERE id = ?').run(hashPassword(pw), s.id);
    db.prepare('DELETE FROM student_sessions WHERE student_id = ? AND token_hash != ?').run(s.id, sha256(parseCookies(req).tc_student));
    res.json({ ok: true });
  })
);

app.post(
  '/api/me/enrollments/:ref/payment',
  enrollLimit,
  h(async (req, res) => {
    const code = normalizeCode(req.body?.mpesa_code);
    if (!/^[A-Z0-9]{10}$/.test(code)) throw bad('An M-PESA code is 10 letters and numbers, e.g. SJK4H7Q2LM.');
    const e = db.prepare('SELECT * FROM enrollments WHERE ref = ? AND student_id = ?').get(String(req.params.ref).toUpperCase(), req.student.id);
    if (!e) throw new HttpError(404, 'Registration not found.');
    if (e.status === 'confirmed') throw bad('This payment is already confirmed.');
    if (db.prepare('SELECT 1 FROM enrollments WHERE mpesa_code = ? AND id != ?').get(code, e.id)) {
      throw new HttpError(409, 'That M-PESA code has already been used for another registration.');
    }
    db.prepare("UPDATE enrollments SET mpesa_code = ?, paid_at = ?, status = 'pending_review', reject_reason = NULL WHERE id = ?").run(
      code,
      nowIso(),
      e.id
    );
    const st = getSettings();
    if (st.notify_email) {
      const msg = emails.paymentToReview({
        enrollment: { ...e, mpesa_code: code },
        module: getModule(e.module_id),
        baseUrl: baseUrl(req),
        staffPath: STAFF_PATH,
      });
      sendMail({ to: st.notify_email, ...msg });
    }
    res.json({ ok: true });
  })
);

app.post(
  '/api/me/redeem',
  rateLimit(10, 15 * 60 * 1000),
  h((req, res) => {
    const code = normalizeCode(req.body?.code);
    if (code.length !== 8) throw bad('Codes are 8 characters, like ABCD-2345.');
    const e = db.prepare("SELECT * FROM enrollments WHERE code_hash = ? AND status = 'confirmed'").get(sha256(code));
    if (!e) throw bad('That code is not valid.');
    if (e.track !== 'self') throw bad('That code is your ticket for a class, not for videos. Keep it and show it to your teacher.');
    if (e.student_id && e.student_id !== req.student.id) throw bad('That code belongs to another account.');
    if (e.code_used_at) throw bad('That code has already been used. Contact us if you need a new one.');
    db.prepare('UPDATE enrollments SET code_used_at = ?, student_id = ? WHERE id = ?').run(nowIso(), req.student.id, e.id);
    res.json({ ok: true, module: getModule(e.module_id).title });
  })
);

app.get(
  '/api/me/video/:id',
  h((req, res) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(optionalId(req.params.id));
    if (!video || !libraryModuleIds(req.student.id).includes(video.module_id)) {
      throw new HttpError(403, 'You do not have access to this video.');
    }
    streamVideo(req, res, video);
  })
);

// ------------------------------- Staff auth --------------------------------

function staffAuth(req, res, next) {
  const token = parseCookies(req).tc_staff;
  const staff =
    token &&
    db
      .prepare(
        `SELECT s.id, s.name, s.email, s.role FROM staff_sessions ss JOIN staff s ON s.id = ss.staff_id
          WHERE ss.token_hash = ? AND ss.expires_at > ? AND s.active = 1`
      )
      .get(sha256(token), Date.now());
  if (!staff) return res.status(401).json({ error: 'Please log in.' });
  req.staff = staff;
  next();
}
function adminOnly(req, res, next) {
  if (req.staff.role !== 'admin') return res.status(403).json({ error: 'Only an admin can do that.' });
  next();
}

app.post(
  '/api/staff/login',
  rateLimit(10, 15 * 60 * 1000),
  h((req, res) => {
    const s = db.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').get(String(req.body?.email || '').trim());
    if (!s || !verifyPassword(String(req.body?.password || ''), s.pass_hash)) {
      throw new HttpError(401, 'Wrong email or password.');
    }
    const token = randomToken();
    db.prepare('DELETE FROM staff_sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO staff_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)').run(
      sha256(token),
      s.id,
      Date.now() + STAFF_SESSION_MS
    );
    setCookie(res, 'tc_staff', token, { maxAgeSec: STAFF_SESSION_MS / 1000 });
    res.json({ id: s.id, name: s.name, email: s.email, role: s.role });
  })
);

app.post('/api/staff/logout', (req, res) => {
  const token = parseCookies(req).tc_staff;
  if (token) db.prepare('DELETE FROM staff_sessions WHERE token_hash = ?').run(sha256(token));
  setCookie(res, 'tc_staff', '', { maxAgeSec: 0 });
  res.json({ ok: true });
});

app.use('/api/staff', staffAuth);
app.use('/api/admin', staffAuth, adminOnly);

app.get('/api/staff/me', (req, res) => res.json({ ...req.staff, mail_configured: mailConfigured }));

app.post(
  '/api/staff/password',
  h((req, res) => {
    const s = db.prepare('SELECT pass_hash FROM staff WHERE id = ?').get(req.staff.id);
    if (!verifyPassword(String(req.body?.current || ''), s.pass_hash)) throw bad('Current password is wrong.');
    const next = String(req.body?.next || '');
    if (next.length < 10) throw bad('New password must be at least 10 characters.');
    db.prepare('UPDATE staff SET pass_hash = ? WHERE id = ?').run(hashPassword(next), req.staff.id);
    // Log out every other session for this account.
    db.prepare('DELETE FROM staff_sessions WHERE staff_id = ? AND token_hash != ?').run(req.staff.id, sha256(parseCookies(req).tc_staff));
    res.json({ ok: true });
  })
);

// ------------------------------- Classes (admin + teachers) ----------------

app.get('/api/staff/options', (req, res) => {
  res.json({
    modules: db.prepare('SELECT id, title, active FROM modules ORDER BY sort, id').all(),
    teachers: db.prepare('SELECT id, name, role FROM staff WHERE active = 1 ORDER BY name').all(),
  });
});

app.get('/api/staff/classes', (req, res) => {
  const scope = req.query.scope === 'past' ? '<' : '>=';
  const order = scope === '<' ? 'DESC' : 'ASC';
  const rows = db
    .prepare(
      `SELECT c.*, m.title AS module_title, s.name AS teacher_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'confirmed') AS confirmed,
              (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status IN ('awaiting_payment','pending_review')) AS pending,
              (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.code_used_at IS NOT NULL) AS checked_in
         FROM classes c JOIN modules m ON m.id = c.module_id LEFT JOIN staff s ON s.id = c.teacher_id
        WHERE c.starts_at ${scope} ? ORDER BY c.starts_at ${order} LIMIT 200`
    )
    .all(nowNairobi());
  res.json(rows);
});

function readClass(b, staffId) {
  const mode = String(b.mode);
  if (mode !== 'live' && mode !== 'physical') throw bad('Mode must be live or physical.');
  const mod = getModule(optionalId(b.module_id));
  if (!mod) throw bad('Choose a module.');
  const teacherId = optionalId(b.teacher_id) ?? staffId;
  if (!db.prepare('SELECT 1 FROM staff WHERE id = ?').get(teacherId)) throw bad('Unknown teacher.');
  return {
    module_id: mod.id,
    mode,
    title: text(b.title, 150) || mod.title,
    starts_at: startsAt(b.starts_at),
    duration_min: int(b.duration_min ?? 60, { min: 15, max: 600, label: 'Duration' }),
    location: mode === 'physical' ? text(b.location, 300) : '',
    meeting_link: mode === 'live' ? httpsUrl(b.meeting_link) : '',
    capacity: int(b.capacity ?? 0, { min: 0, max: 10000, label: 'Capacity' }),
    teacher_id: teacherId,
  };
}

app.post(
  '/api/staff/classes',
  h((req, res) => {
    const c = readClass(req.body || {}, req.staff.id);
    const r = db
      .prepare(
        `INSERT INTO classes (module_id, mode, title, starts_at, duration_min, location, meeting_link, capacity, teacher_id)
         VALUES (:module_id, :mode, :title, :starts_at, :duration_min, :location, :meeting_link, :capacity, :teacher_id)`
      )
      .run(c);
    res.json({ id: Number(r.lastInsertRowid) });
  })
);

app.put(
  '/api/staff/classes/:id',
  h((req, res) => {
    const existing = getClass(optionalId(req.params.id));
    if (!existing) throw new HttpError(404, 'Class not found.');
    const c = readClass(req.body || {}, req.staff.id);
    if (c.mode !== existing.mode || c.module_id !== existing.module_id) {
      const has = db.prepare('SELECT 1 FROM enrollments WHERE class_id = ?').get(existing.id);
      if (has) throw bad('Students are already booked, so the module and mode cannot change. Create a new class instead.');
    }
    db.prepare(
      `UPDATE classes SET module_id = :module_id, mode = :mode, title = :title, starts_at = :starts_at, duration_min = :duration_min,
              location = :location, meeting_link = :meeting_link, capacity = :capacity, teacher_id = :teacher_id WHERE id = :id`
    ).run({ ...c, id: existing.id });
    res.json({ ok: true });
  })
);

app.delete(
  '/api/staff/classes/:id',
  h((req, res) => {
    const cls = getClass(optionalId(req.params.id));
    if (!cls) throw new HttpError(404, 'Class not found.');
    if (req.staff.role !== 'admin' && cls.teacher_id !== req.staff.id) throw new HttpError(403, 'You can only delete your own classes.');
    const booked = db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE class_id = ? AND status != 'rejected'").get(cls.id).n;
    if (booked) throw bad(`${booked} student(s) are booked on this class. Move them to another class first.`);
    db.prepare('DELETE FROM classes WHERE id = ?').run(cls.id);
    res.json({ ok: true });
  })
);

app.get(
  '/api/staff/classes/:id/roster',
  h((req, res) => {
    const cls = getClass(optionalId(req.params.id));
    if (!cls) throw new HttpError(404, 'Class not found.');
    const rows = db
      .prepare(
        `SELECT id, ref, name, email, phone, status, code_used_at, link_sent_at FROM enrollments
          WHERE class_id = ? AND status != 'rejected' ORDER BY status = 'confirmed' DESC, name`
      )
      .all(cls.id);
    res.json(rows);
  })
);

app.post(
  '/api/staff/classes/:id/send-links',
  h(async (req, res) => {
    const cls = getClass(optionalId(req.params.id));
    if (!cls) throw new HttpError(404, 'Class not found.');
    if (cls.mode !== 'live') throw bad('Meeting links are only for live online classes.');
    if (!cls.meeting_link) throw bad('Add a meeting link to the class first.');
    const onlyNew = req.body?.only_new !== false;
    const students = db
      .prepare(
        `SELECT * FROM enrollments WHERE class_id = ? AND status = 'confirmed' ${onlyNew ? 'AND link_sent_at IS NULL' : ''}`
      )
      .all(cls.id);
    const s = getSettings();
    let sent = 0;
    for (const e of students) {
      await sendMail({ to: e.email, ...emails.meetingLink({ enrollment: e, cls, settings: s }) });
      db.prepare('UPDATE enrollments SET link_sent_at = ? WHERE id = ?').run(nowIso(), e.id);
      sent++;
    }
    res.json({ sent });
  })
);

app.post(
  '/api/staff/classes/:id/message',
  h(async (req, res) => {
    const cls = getClass(optionalId(req.params.id));
    if (!cls) throw new HttpError(404, 'Class not found.');
    const subject = text(req.body?.subject, 150, { required: true, label: 'Subject' });
    const body = text(req.body?.body, 5000, { required: true, label: 'Message' });
    const students = db.prepare("SELECT * FROM enrollments WHERE class_id = ? AND status = 'confirmed'").all(cls.id);
    const s = getSettings();
    for (const e of students) await sendMail({ to: e.email, ...emails.classMessage({ enrollment: e, subject, body, settings: s }) });
    res.json({ sent: students.length });
  })
);

/** Teachers enter a student's one-time code at the start of class. Each code checks in once. */
app.post(
  '/api/staff/checkin',
  h((req, res) => {
    const code = normalizeCode(req.body?.code);
    const e = db
      .prepare(
        `SELECT e.*, m.title AS module_title, c.title AS class_title, c.starts_at
           FROM enrollments e JOIN modules m ON m.id = e.module_id LEFT JOIN classes c ON c.id = e.class_id
          WHERE e.code_hash = ? AND e.status = 'confirmed'`
      )
      .get(sha256(code));
    if (!e) throw new HttpError(404, 'Code not recognised. Ask the student to check their email.');
    if (e.track === 'self') throw bad('That is a video-library code, not a class ticket.');
    const student = {
      name: e.name,
      phone: e.phone,
      ref: e.ref,
      track: e.track,
      module: e.module_title,
      class: e.class_title || '(no class assigned)',
      starts_at: e.starts_at,
    };
    if (e.code_used_at) return res.status(409).json({ error: `Already checked in at ${new Date(e.code_used_at).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })}.`, student });
    db.prepare('UPDATE enrollments SET code_used_at = ? WHERE id = ?').run(nowIso(), e.id);
    res.json({ ok: true, student });
  })
);

// ------------------------------- Admin: payments ---------------------------

app.get('/api/admin/enrollments', (req, res) => {
  const status = String(req.query.status || 'pending_review');
  const where = status === 'all' ? '' : 'WHERE e.status = ?';
  const args = status === 'all' ? [] : [status];
  const rows = db
    .prepare(
      `SELECT e.*, m.title AS module_title, c.title AS class_title, c.starts_at AS class_starts_at
         FROM enrollments e JOIN modules m ON m.id = e.module_id LEFT JOIN classes c ON c.id = e.class_id
         ${where} ORDER BY COALESCE(e.paid_at, e.created_at) DESC LIMIT 300`
    )
    .all(...args)
    .map(({ code_hash, ...r }) => ({ ...r, has_code: Boolean(code_hash) }));
  const counts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM enrollments GROUP BY status').all().map((r) => [r.status, r.n])
  );
  res.json({ rows, counts });
});

/** Issue (or reissue) a one-time code and email it. Reissuing invalidates the previous code. */
async function issueCode(req, e) {
  const code = newAccessCode();
  tx(() => {
    db.prepare(
      `UPDATE enrollments SET status = 'confirmed', code_hash = ?, code_used_at = NULL, reject_reason = NULL,
              confirmed_at = COALESCE(confirmed_at, ?), confirmed_by = COALESCE(confirmed_by, ?) WHERE id = ?`
    ).run(code.hash, nowIso(), req.staff.id, e.id);
  });
  const cls = getClass(e.class_id);
  const msg = emails.confirmation({
    enrollment: e,
    module: getModule(e.module_id),
    cls,
    code: code.display,
    settings: getSettings(),
    baseUrl: baseUrl(req),
  });
  const mailStatus = await sendMail({ to: e.email, ...msg });
  if (e.track === 'live' && cls && cls.meeting_link) {
    db.prepare('UPDATE enrollments SET link_sent_at = ? WHERE id = ?').run(nowIso(), e.id);
  }
  return { code: code.display, mail: mailStatus };
}

app.post(
  '/api/admin/enrollments/:id/confirm',
  h(async (req, res) => {
    const e = getEnrollment(optionalId(req.params.id));
    if (!e) throw new HttpError(404, 'Registration not found.');
    if (e.status === 'confirmed') throw bad('Already confirmed. Use "New code" to send a fresh code.');
    res.json(await issueCode(req, e));
  })
);

app.post(
  '/api/admin/enrollments/:id/reissue',
  h(async (req, res) => {
    const e = getEnrollment(optionalId(req.params.id));
    if (!e) throw new HttpError(404, 'Registration not found.');
    if (e.status !== 'confirmed') throw bad('Only confirmed registrations have codes.');
    res.json(await issueCode(req, e));
  })
);

app.post(
  '/api/admin/enrollments/:id/reject',
  h(async (req, res) => {
    const e = getEnrollment(optionalId(req.params.id));
    if (!e) throw new HttpError(404, 'Registration not found.');
    const reason = text(req.body?.reason, 300);
    db.prepare("UPDATE enrollments SET status = 'rejected', reject_reason = ?, code_hash = NULL WHERE id = ?").run(reason || null, e.id);
    if (req.body?.notify !== false) {
      await sendMail({
        to: e.email,
        ...emails.rejection({ enrollment: e, module: getModule(e.module_id), reason, settings: getSettings(), baseUrl: baseUrl(req) }),
      });
    }
    res.json({ ok: true });
  })
);

app.put(
  '/api/admin/enrollments/:id/class',
  h((req, res) => {
    const e = getEnrollment(optionalId(req.params.id));
    if (!e) throw new HttpError(404, 'Registration not found.');
    if (e.track === 'self') throw bad('Self-paced students are not booked on classes.');
    const classId = optionalId(req.body?.class_id);
    if (classId) {
      const cls = getClass(classId);
      if (!cls || cls.mode !== e.track || cls.module_id !== e.module_id) throw bad('That class is for a different module or mode.');
    }
    db.prepare('UPDATE enrollments SET class_id = ?, link_sent_at = NULL WHERE id = ?').run(classId, e.id);
    res.json({ ok: true });
  })
);

// ------------------------------- Admin: modules, prices, videos -----------

app.get('/api/admin/modules', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT m.*, (SELECT COUNT(*) FROM videos v WHERE v.module_id = m.id) AS video_count,
                (SELECT COUNT(*) FROM enrollments e WHERE e.module_id = m.id AND e.status = 'confirmed') AS students
           FROM modules m ORDER BY m.sort, m.id`
      )
      .all()
  );
});

function readModule(b, fallback) {
  const s = getSettings();
  const price = (key, def) => int(b[key] ?? fallback?.[key] ?? def, { min: 0, max: 1_000_000, label: 'Price' });
  return {
    title: text(b.title ?? fallback?.title, 150, { required: true, label: 'Title' }),
    description: text(b.description ?? fallback?.description, 2000),
    sort: int(b.sort ?? fallback?.sort ?? 0, { min: -10000, max: 10000, label: 'Order' }),
    price_self: price('price_self', s.default_price_self),
    price_live: price('price_live', s.default_price_live),
    price_physical: price('price_physical', s.default_price_physical),
    active: b.active === undefined ? (fallback?.active ?? 1) : b.active ? 1 : 0,
  };
}

app.post(
  '/api/admin/modules',
  h((req, res) => {
    const m = readModule(req.body || {});
    const r = db
      .prepare(
        `INSERT INTO modules (title, description, sort, price_self, price_live, price_physical, active)
         VALUES (:title, :description, :sort, :price_self, :price_live, :price_physical, :active)`
      )
      .run(m);
    res.json({ id: Number(r.lastInsertRowid) });
  })
);

app.put(
  '/api/admin/modules/:id',
  h((req, res) => {
    const existing = getModule(optionalId(req.params.id));
    if (!existing) throw new HttpError(404, 'Module not found.');
    const m = readModule(req.body || {}, existing);
    db.prepare(
      `UPDATE modules SET title = :title, description = :description, sort = :sort, price_self = :price_self,
              price_live = :price_live, price_physical = :price_physical, active = :active WHERE id = :id`
    ).run({ ...m, id: existing.id });
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/modules/:id',
  h((req, res) => {
    const m = getModule(optionalId(req.params.id));
    if (!m) throw new HttpError(404, 'Module not found.');
    const used =
      db.prepare('SELECT 1 FROM enrollments WHERE module_id = ?').get(m.id) || db.prepare('SELECT 1 FROM classes WHERE module_id = ?').get(m.id);
    if (used) throw bad('Students or classes already use this module. Hide it instead of deleting it.');
    const files = db.prepare('SELECT filename FROM videos WHERE module_id = ?').all(m.id);
    db.prepare('DELETE FROM modules WHERE id = ?').run(m.id);
    files.forEach((f) => deleteVideoFile(f.filename));
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/modules/apply-default-prices',
  h((req, res) => {
    const s = getSettings();
    const r = db
      .prepare('UPDATE modules SET price_self = ?, price_live = ?, price_physical = ?')
      .run(+s.default_price_self, +s.default_price_live, +s.default_price_physical);
    res.json({ updated: r.changes });
  })
);

const upload = multer({
  storage: multer.diskStorage({
    destination: VIDEO_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0, 8)}`),
  }),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^video\//.test(file.mimetype)),
});

app.get('/api/admin/videos', (req, res) => {
  res.json(db.prepare('SELECT id, module_id, title, mime, size, sort, created_at FROM videos ORDER BY module_id, sort, id').all());
});

app.post(
  '/api/admin/videos',
  upload.single('file'),
  h((req, res) => {
    if (!req.file) throw bad('Choose a video file (mp4 or webm).');
    try {
      const mod = getModule(optionalId(req.body.module_id));
      if (!mod) throw bad('Choose a module.');
      const title = text(req.body.title, 200) || path.parse(req.file.originalname).name;
      const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM videos WHERE module_id = ?').get(mod.id).n;
      const r = db
        .prepare('INSERT INTO videos (module_id, title, filename, mime, size, sort) VALUES (?, ?, ?, ?, ?, ?)')
        .run(mod.id, title, req.file.filename, req.file.mimetype, req.file.size, sort);
      res.json({ id: Number(r.lastInsertRowid) });
    } catch (err) {
      deleteVideoFile(req.file.filename);
      throw err;
    }
  })
);

app.put(
  '/api/admin/videos/:id',
  h((req, res) => {
    const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(optionalId(req.params.id));
    if (!v) throw new HttpError(404, 'Video not found.');
    db.prepare('UPDATE videos SET title = ?, sort = ? WHERE id = ?').run(
      text(req.body?.title ?? v.title, 200, { required: true, label: 'Title' }),
      int(req.body?.sort ?? v.sort, { min: -10000, max: 10000, label: 'Order' }),
      v.id
    );
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/videos/:id',
  h((req, res) => {
    const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(optionalId(req.params.id));
    if (!v) throw new HttpError(404, 'Video not found.');
    db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
    deleteVideoFile(v.filename);
    res.json({ ok: true });
  })
);

app.get(
  '/api/admin/videos/:id/stream',
  h((req, res) => {
    const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(optionalId(req.params.id));
    if (!v) throw new HttpError(404, 'Video not found.');
    streamVideo(req, res, v);
  })
);

// ------------------------------- Admin: settings, staff, outbox ------------

const EDITABLE_SETTINGS = [
  'school_name',
  'tagline',
  'default_price_self',
  'default_price_live',
  'default_price_physical',
  'mpesa_method',
  'mpesa_number',
  'mpesa_account_name',
  'contact_phone',
  'contact_email',
  'notify_email',
];

app.get('/api/admin/settings', (req, res) => res.json(getSettings()));

app.put(
  '/api/admin/settings',
  h((req, res) => {
    const b = req.body || {};
    const out = {};
    for (const key of EDITABLE_SETTINGS) {
      if (b[key] === undefined) continue;
      if (key.startsWith('default_price_')) out[key] = int(b[key], { min: 0, max: 1_000_000, label: 'Price' });
      else if (key === 'mpesa_method') {
        if (!['till', 'paybill', 'phone'].includes(b[key])) throw bad('Unknown M-PESA method.');
        out[key] = b[key];
      } else if (key === 'notify_email' || key === 'contact_email') out[key] = b[key] ? email(b[key]) : '';
      else out[key] = text(b[key], 300);
    }
    setSettings(out);
    res.json(getSettings());
  })
);

app.get('/api/admin/staff', (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, active, created_at FROM staff ORDER BY role, name').all());
});

app.post(
  '/api/admin/staff',
  h((req, res) => {
    const b = req.body || {};
    const role = b.role === 'admin' ? 'admin' : 'teacher';
    const password = String(b.password || '');
    if (password.length < 10) throw bad('Password must be at least 10 characters.');
    const mail = email(b.email);
    if (db.prepare('SELECT 1 FROM staff WHERE email = ?').get(mail)) throw bad('Someone already uses that email.');
    const r = db
      .prepare('INSERT INTO staff (name, email, pass_hash, role) VALUES (?, ?, ?, ?)')
      .run(text(b.name, 100, { required: true, label: 'Name' }), mail, hashPassword(password), role);
    res.json({ id: Number(r.lastInsertRowid) });
  })
);

app.put(
  '/api/admin/staff/:id',
  h((req, res) => {
    const s = db.prepare('SELECT * FROM staff WHERE id = ?').get(optionalId(req.params.id));
    if (!s) throw new HttpError(404, 'Staff member not found.');
    if (s.id === req.staff.id) throw bad('You cannot change your own role or disable yourself.');
    const b = req.body || {};
    const role = b.role === undefined ? s.role : b.role === 'admin' ? 'admin' : 'teacher';
    const active = b.active === undefined ? s.active : b.active ? 1 : 0;
    const password = b.password ? String(b.password) : null;
    if (password && password.length < 10) throw bad('Password must be at least 10 characters.');
    tx(() => {
      db.prepare('UPDATE staff SET role = ?, active = ? WHERE id = ?').run(role, active, s.id);
      if (password) db.prepare('UPDATE staff SET pass_hash = ? WHERE id = ?').run(hashPassword(password), s.id);
      if (!active || password) db.prepare('DELETE FROM staff_sessions WHERE staff_id = ?').run(s.id);
    });
    res.json({ ok: true });
  })
);

app.get('/api/admin/outbox', (req, res) => {
  res.json(db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 100').all());
});

app.get('/api/admin/students', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT s.id, s.name, s.email, s.phone, s.active, s.created_at, s.last_login_at,
                s.google_sub IS NOT NULL AS google, s.pass_hash IS NOT NULL AS has_password,
                (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.id) AS registrations,
                (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.id AND e.status = 'confirmed') AS paid,
                (SELECT COUNT(*) FROM student_sessions ss WHERE ss.student_id = s.id AND ss.expires_at > ?) AS devices
           FROM students s ORDER BY s.created_at DESC LIMIT 500`
      )
      .all(Date.now())
  );
});

app.put(
  '/api/admin/students/:id',
  h((req, res) => {
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(optionalId(req.params.id));
    if (!s) throw new HttpError(404, 'Student not found.');
    const active = req.body?.active ? 1 : 0;
    tx(() => {
      db.prepare('UPDATE students SET active = ? WHERE id = ?').run(active, s.id);
      if (!active) db.prepare('DELETE FROM student_sessions WHERE student_id = ?').run(s.id);
    });
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/students/:id/signout',
  h((req, res) => {
    const r = db.prepare('DELETE FROM student_sessions WHERE student_id = ?').run(optionalId(req.params.id));
    res.json({ signed_out: r.changes });
  })
);

// ------------------------------- Pages -------------------------------------

const staffPage = fs.readFileSync(path.join(__dirname, 'private', 'staff.html'), 'utf8').replaceAll('{{STAFF_PATH}}', STAFF_PATH);
app.get(STAFF_PATH, (req, res) => {
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
  res.type('html').send(staffPage);
});
app.get(`${STAFF_PATH}/staff.js`, (req, res) => res.sendFile(path.join(__dirname, 'private', 'staff.js')));
app.get('/learn', (req, res) => res.redirect(301, '/account'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Video is larger than ${MAX_VIDEO_MB} MB.` : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(PORT, () => {
  console.log(`Travia Cafe running on http://localhost:${PORT}`);
  console.log(`Staff dashboard: http://localhost:${PORT}${STAFF_PATH}`);
  if (!mailConfigured) console.log('SMTP is not configured: emails are logged to the console and the dashboard outbox.');
});
