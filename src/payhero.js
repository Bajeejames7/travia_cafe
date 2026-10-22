'use strict';
/**
 * PayHero (payherokenya.com) M-PESA STK push: the student gets a PIN prompt on their phone and
 * PayHero tells us when they have paid. Off unless PAYHERO_AUTH and PAYHERO_CHANNEL_ID are set.
 *
 * PayHero callbacks are not signed, so a callback is only a hint. A payment counts only once
 * PayHero's transaction-status API confirms a reference that our own server created.
 */
const API = (process.env.PAYHERO_API_URL || 'https://backend.payhero.co.ke/api/v2').replace(/\/+$/, '');
// PayHero shows the token as "Basic xxxx"; accept it with or without the prefix.
const token = String(process.env.PAYHERO_AUTH || '')
  .trim()
  .replace(/^Basic\s+/i, '');
const channelId = Number(process.env.PAYHERO_CHANNEL_ID) || 0;
const enabled = Boolean(token && channelId);

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_message || data.message || data.error || `PayHero error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Sends the M-PESA PIN prompt. `phone` is 2547XXXXXXXX. Returns PayHero's reference for status checks. */
async function stkPush({ amount, phone, ref, name, callbackUrl }) {
  const r = await call('/payments', {
    method: 'POST',
    body: {
      amount,
      phone_number: `0${phone.slice(3)}`,
      channel_id: channelId,
      provider: 'm-pesa',
      external_reference: ref,
      customer_name: name,
      callback_url: callbackUrl,
    },
  });
  if (!r.success || !r.reference) throw new Error('PayHero did not accept the payment request.');
  return { reference: String(r.reference), checkoutId: String(r.CheckoutRequestID || '') };
}

const PENDING = new Set(['', 'QUEUED', 'PENDING', 'PROCESSING']);

/** Asks PayHero what happened: state is 'queued' | 'success' | 'failed', plus the M-PESA receipt once paid. */
async function status(reference) {
  const r = await call(`/transaction-status?reference=${encodeURIComponent(reference)}`);
  const s = String(r.status || '').toUpperCase();
  return {
    state: s === 'SUCCESS' ? 'success' : PENDING.has(s) ? 'queued' : 'failed',
    receipt: String(r.provider_reference || r.third_party_reference || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ''),
  };
}

module.exports = { enabled, stkPush, status };
