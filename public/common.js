'use strict';
/* Shared helpers for the public pages and the staff dashboard. */

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { 'X-TC': '1' }, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const ksh = (n) => Number(n || 0).toLocaleString('en-KE');

/** '2026-10-20T18:00' (Nairobi time) -> 'Tue 20 Oct, 18:00' */
function fmtWhen(s) {
  if (!s) return '';
  const [date, time] = s.split('T');
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${time}`;
}

function notice(el, kind, html) {
  el.innerHTML = html ? `<div class="notice ${kind}">${html}</div>` : '';
}

const TRACK_LABEL = { self: 'Self-paced', live: 'Live online', physical: 'In person' };

/** Step-by-step M-PESA instructions as <li> HTML. */
function paymentSteps(payment, { amount, ref } = {}) {
  const num = payment.number ? `<strong class="mono">${esc(payment.number)}</strong>` : '<em>(number coming soon)</em>';
  const amt = amount ? `<strong>KSh ${ksh(amount)}</strong>` : 'the amount for your module';
  const name = payment.account_name ? ` Check that the name shown is <strong>${esc(payment.account_name)}</strong>.` : '';
  const steps = ['Open the <strong>M-PESA</strong> menu on your phone (or the M-PESA app).'];
  if (payment.method === 'paybill') {
    steps.push(
      'Choose <strong>Lipa na M-PESA</strong> → <strong>Pay Bill</strong>.',
      `Business number: ${num}.`,
      `Account number: ${ref ? `<strong class="mono">${esc(ref)}</strong> (your reference)` : 'your registration reference (e.g. TC7KQ2MA)'}.`
    );
  } else if (payment.method === 'phone') {
    steps.push('Choose <strong>Send Money</strong>.', `Enter phone number ${num}.`);
  } else {
    steps.push('Choose <strong>Lipa na M-PESA</strong> → <strong>Buy Goods and Services</strong>.', `Till number: ${num}.`);
  }
  steps.push(
    `Enter ${amt}.`,
    `Enter your M-PESA PIN and confirm.${name}`,
    'You will get an SMS from M-PESA starting with a 10-character code, e.g. <span class="mono">SJK4H7Q2LM</span>. Enter that code on this page.',
    'We confirm the payment and email you a <strong>one-time code</strong> — for videos, for your class ticket, and (for live classes) your meeting link.'
  );
  return steps.map((s) => `<li>${s}</li>`).join('');
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function withBusy(button, fn) {
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.disabled = false;
  }
}
