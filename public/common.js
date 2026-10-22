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

/** '2026-10-20T18:00' -> { day: '20', month: 'Oct', weekday: 'Tue', time: '18:00' } for date chips. */
function dateParts(s) {
  const [date, time] = s.split('T');
  const d = new Date(`${date}T00:00:00Z`);
  const part = (o) => d.toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
  return { day: part({ day: 'numeric' }), month: part({ month: 'short' }), weekday: part({ weekday: 'short' }), time };
}

/** A WhatsApp chat link for a Kenyan number typed any common way, or '' if it does not look like one. */
function whatsappLink(phone) {
  const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(String(phone || '').replace(/[^\d+]/g, ''));
  return m ? `https://wa.me/254${m[1]}` : '';
}

/** Buttons with data-copy="text" copy that text and say so for a moment. */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  e.preventDefault();
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    btn.classList.add('done');
    setTimeout(() => btn.classList.remove('done'), 1600);
  } catch {
    // Clipboard blocked (old browser or http): the text is on screen to copy by hand.
  }
});
const copyBtn = (value, label = value) =>
  `<button type="button" class="copy" data-copy="${esc(value)}" aria-label="Copy ${esc(label)}">${esc(label)}</button>`;

function notice(el, kind, html) {
  el.innerHTML = html ? `<div class="notice ${kind}">${html}</div>` : '';
}

const TRACK_LABEL = { self: 'Self-paced', live: 'Live online', physical: 'In person' };

/** Step-by-step M-PESA instructions as <li> HTML. */
function paymentSteps(payment, { amount, ref } = {}) {
  const num = payment.number ? copyBtn(payment.number) : '<em>(number coming soon)</em>';
  const amt = amount ? `<strong>KSh ${ksh(amount)}</strong>` : 'the amount for your module';
  const name = payment.account_name ? ` Check that the name shown is <strong>${esc(payment.account_name)}</strong>.` : '';
  const steps = ['Open the <strong>M-PESA</strong> menu on your phone (or the M-PESA app).'];
  if (payment.method === 'paybill') {
    steps.push(
      'Choose <strong>Lipa na M-PESA</strong> → <strong>Pay Bill</strong>.',
      `Business number: ${num}.`,
      `Account number: ${ref ? `${copyBtn(ref)} (your reference)` : 'your registration reference (e.g. TC7KQ2MA)'}.`
    );
  } else if (payment.method === 'phone') {
    steps.push('Choose <strong>Send Money</strong>.', `Enter phone number ${num}.`);
  } else {
    steps.push('Choose <strong>Lipa na M-PESA</strong> → <strong>Buy Goods and Services</strong>.', `Till number: ${num}.`);
  }
  steps.push(
    `Enter ${amt}.`,
    `Enter your M-PESA PIN and confirm.${name}`,
    'M-PESA sends you an SMS that starts with a 10-character code, e.g. <span class="mono">SJK4H7Q2LM</span>. Enter that code in your dashboard.',
    'We confirm the payment. Videos unlock in your dashboard; class tickets and live class links are emailed to you.'
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

/** Copies each table's column headings onto its cells, so the phone layout can label stacked cards. */
function labelTables() {
  document.querySelectorAll('.table-wrap table').forEach((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        if (!td.hasAttribute('data-label')) td.setAttribute('data-label', td.colSpan > 1 ? '' : heads[i] || '');
      });
    });
  });
}
let labelQueued = false;
new MutationObserver(() => {
  if (labelQueued) return;
  labelQueued = true;
  requestAnimationFrame(() => {
    labelQueued = false;
    labelTables();
  });
}).observe(document.documentElement, { childList: true, subtree: true });
