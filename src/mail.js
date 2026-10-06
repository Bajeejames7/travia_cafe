'use strict';
const nodemailer = require('nodemailer');
const { db } = require('./db');

const port = Number(process.env.SMTP_PORT) || 587;
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';

/**
 * Sends a plain-text email and records it in the outbox, so staff can see and
 * copy what went out (or what failed) from the dashboard. Never throws.
 */
async function sendMail({ to, subject, text }) {
  let status = 'logged';
  let error = null;
  if (transport) {
    try {
      await transport.sendMail({ from: FROM, to, subject, text });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err.message;
      console.error(`[mail] failed to send to ${to}: ${err.message}`);
    }
  } else {
    console.log(`[mail] SMTP not configured — logged only\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
  }
  db.prepare('INSERT INTO outbox (to_email, subject, body, status, error) VALUES (?, ?, ?, ?, ?)').run(
    to,
    subject,
    text,
    status,
    error
  );
  return status;
}

module.exports = { sendMail, mailConfigured: Boolean(transport) };
