'use strict';
const crypto = require('crypto');

const PROD = process.env.NODE_ENV === 'production';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, key] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const derived = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(derived, Buffer.from(key, 'hex'));
}

// No 0/O/1/I so codes read cleanly over the phone or off an SMS.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomChars(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** One-time access code, shown as XXXX-XXXX. */
function newAccessCode() {
  const raw = randomChars(8);
  return { display: `${raw.slice(0, 4)}-${raw.slice(4)}`, hash: sha256(raw) };
}

/** Normalises what a person typed (spaces, dashes, lowercase) back to the raw code. */
function normalizeCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, { maxAgeSec, sameSite = 'Strict' }) {
  res.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSec}${PROD ? '; Secure' : ''}`
  );
}

/** Small fixed-window, per-IP limiter. Good enough for a single-instance app. */
function rateLimit(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(req.ip, h);
    }
    if (++h.n > max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    next();
  };
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
}

/**
 * State-changing API calls must carry the X-TC header. Browsers will not send a
 * custom header cross-site without a CORS preflight we never approve, so this
 * blocks CSRF on top of the SameSite cookies.
 */
function requireAppHeader(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.get('x-tc') !== '1') return res.status(403).json({ error: 'Forbidden' });
  next();
}

module.exports = {
  PROD,
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
};
