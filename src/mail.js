'use strict';
const nodemailer = require('nodemailer');
const { db } = require('./db');

/*
 * Two ways to send, picked by what is configured:
 * - BREVO_API_KEY: Brevo's HTTPS API (free: 300 emails a day). Works on Render's free plan, which blocks the
 *   usual email (SMTP) ports.
 * - SMTP_HOST: any SMTP server (Gmail with an App Password, Zoho, ...), for hosts that allow SMTP.
 * With neither, emails are only logged, and staff can read them in the dashboard's Emails tab.
 */
const BREVO_KEY = process.env.BREVO_API_KEY || '';
const BREVO_URL = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';

const port = Number(process.env.SMTP_PORT) || 587;
const transport =
  !BREVO_KEY && process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    : null;

const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';
const REPLY_TO = process.env.MAIL_REPLY_TO || '';
if (BREVO_KEY && !process.env.MAIL_FROM) console.warn('[mail] BREVO_API_KEY is set but MAIL_FROM is not: Brevo will reject the sender.');

/** "Travia Cafe <hello@traviacafe.com>" -> { name, email } */
function parseAddress(s) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: s.trim() };
}

async function sendBrevo({ to, subject, text }) {
  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: parseAddress(FROM),
      to: [{ email: to }],
      subject,
      textContent: text,
      ...(REPLY_TO ? { replyTo: parseAddress(REPLY_TO) } : {}),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/**
 * Sends a plain-text email and records it in the outbox, so staff can see and
 * copy what went out (or what failed) from the dashboard. Never throws.
 */
async function sendMail({ to, subject, text }) {
  let status = 'logged';
  let error = null;
  if (BREVO_KEY || transport) {
    try {
      if (BREVO_KEY) await sendBrevo({ to, subject, text });
      else await transport.sendMail({ from: FROM, to, subject, text, ...(REPLY_TO ? { replyTo: REPLY_TO } : {}) });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err.message;
      console.error(`[mail] failed to send to ${to}: ${err.message}`);
    }
  } else {
    console.log(`[mail] email not configured — logged only\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
  }
  await db
    .run('INSERT INTO outbox (to_email, subject, body, status, error) VALUES (?, ?, ?, ?, ?)', to, subject, text, status, error)
    .catch((err) => console.error(`[mail] could not record outbox entry: ${err.message}`));
  return status;
}

module.exports = { sendMail, mailConfigured: Boolean(BREVO_KEY || transport) };
