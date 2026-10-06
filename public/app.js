'use strict';
/* Public storefront: prices, enrolment, M-PESA payment submission. */

let catalog = null;
let current = null; // { ref, email, amount }

const $ = (sel, root = document) => root.querySelector(sel);
const enrollForm = $('#enrollForm');

function track() {
  return enrollForm.track.value;
}

function selectedModule() {
  return catalog.modules.find((m) => String(m.id) === enrollForm.module_id.value);
}

function priceFor(mod, t) {
  return mod ? mod[{ self: 'price_self', live: 'price_live', physical: 'price_physical' }[t]] : null;
}

function renderCatalog() {
  const { school, prices, modules, payment } = catalog;
  document.title = `${school.name} — Cybersecurity School`;
  document.querySelectorAll('[data-school]').forEach((el) => (el.textContent = school.name));
  if (school.tagline) $('[data-tagline]').textContent = school.tagline;

  // "From" price on each track card = cheapest active module, or the default.
  for (const t of ['self', 'live', 'physical']) {
    const list = modules.map((m) => priceFor(m, t));
    $(`[data-price="${t}"]`).textContent = ksh(list.length ? Math.min(...list) : prices[t]);
  }

  $('#moduleRows').innerHTML = modules.length
    ? modules
        .map(
          (m) => `<tr>
            <td><strong>${esc(m.title)}</strong>${m.description ? `<div class="muted small">${esc(m.description)}</div>` : ''}</td>
            <td class="num">KSh ${ksh(m.price_self)}</td>
            <td class="num">KSh ${ksh(m.price_live)}</td>
            <td class="num">KSh ${ksh(m.price_physical)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="muted">Modules will be published soon.</td></tr>';

  enrollForm.module_id.innerHTML = modules.length
    ? modules.map((m) => `<option value="${m.id}">${esc(m.title)}</option>`).join('')
    : '<option value="">No modules yet</option>';

  $('#payGuide').innerHTML = paymentSteps(payment);

  const contact = [school.contact_phone, school.contact_email].filter(Boolean);
  $('#contactLine').innerHTML = contact.map(esc).join(' · ');
  updateForm();
}

function updateForm() {
  const t = track();
  const mod = selectedModule();
  const classField = $('#classField');
  classField.hidden = t === 'self';
  if (t !== 'self' && mod) {
    const options = catalog.classes.filter((c) => c.module_id === mod.id && c.mode === t);
    enrollForm.class_id.innerHTML =
      options
        .map((c) => {
          const where = c.mode === 'physical' && c.location ? ` · ${esc(c.location)}` : '';
          return `<option value="${c.id}" ${c.full ? 'disabled' : ''}>${esc(fmtWhen(c.starts_at))} — ${esc(c.title)}${where}${c.full ? ' (full)' : ''}</option>`;
        })
        .join('') + `<option value="">Next available date — we'll email you</option>`;
    const firstOpen = options.find((c) => !c.full);
    enrollForm.class_id.value = firstOpen ? firstOpen.id : '';
  }
  $('#enrollAmount').textContent = mod ? ksh(priceFor(mod, t)) : '—';
}

enrollForm.addEventListener('change', (e) => {
  if (e.target.name === 'track' || e.target.name === 'module_id') updateForm();
});

document.querySelectorAll('[data-pick]').forEach((a) =>
  a.addEventListener('click', () => {
    enrollForm.querySelector(`input[value="${a.dataset.pick}"]`).checked = true;
    updateForm();
  })
);

enrollForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#enrollMsg');
  notice(msg);
  const data = formData(enrollForm);
  try {
    const r = await withBusy(enrollForm.querySelector('button[type=submit]'), () => api('/api/enroll', { method: 'POST', body: data }));
    current = { ref: r.ref, email: data.email, amount: r.amount };
    showPayStep();
  } catch (err) {
    notice(msg, 'err', esc(err.message));
  }
});

function showPayStep() {
  enrollForm.hidden = true;
  $('#payStep').hidden = false;
  $('#payRef').textContent = current.ref;
  $('#payAmount').textContent = ksh(current.amount);
  $('#payStepList').innerHTML = paymentSteps(catalog.payment, current);
  $('#enroll').scrollIntoView();
}

$('#payForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#payMsg');
  notice(msg);
  try {
    await withBusy(e.target.querySelector('button'), () =>
      api('/api/enroll/payment', { method: 'POST', body: { ref: current.ref, email: current.email, mpesa_code: e.target.mpesa_code.value } })
    );
    $('#payStep').hidden = true;
    $('#doneStep').hidden = false;
    $('#doneEmail').textContent = current.email;
    $('#doneRef').textContent = current.ref;
  } catch (err) {
    notice(msg, 'err', esc(err.message));
  }
});

const STATUS_TEXT = {
  awaiting_payment: ['warn', 'Waiting for your M-PESA payment.'],
  pending_review: ['info', 'Payment submitted — we are checking it. Your code will arrive by email.'],
  confirmed: ['ok', 'Confirmed. Your one-time code was emailed to you.'],
  rejected: ['err', 'We could not confirm this payment.'],
};

$('#lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#lookupResult');
  notice(out);
  const data = formData(e.target);
  try {
    const r = await withBusy(e.target.querySelector('button'), () => api('/api/enroll/status', { method: 'POST', body: data }));
    const [kind, txt] = STATUS_TEXT[r.status] || ['', r.status];
    let html = `<strong>${esc(r.module)}</strong> · ${esc(TRACK_LABEL[r.track])} · KSh ${ksh(r.amount)}<br>${txt}`;
    if (r.reject_reason) html += `<br>Reason: ${esc(r.reject_reason)}`;
    notice(out, kind === 'info' ? '' : kind, html);
    if (r.status === 'awaiting_payment' || r.status === 'rejected' || r.status === 'pending_review') {
      current = { ref: r.ref, email: data.email, amount: r.amount };
      const again = document.createElement('button');
      again.className = 'btn small';
      again.type = 'button';
      again.textContent = r.status === 'pending_review' ? 'Correct my M-PESA code' : 'Pay / submit M-PESA code';
      again.addEventListener('click', () => {
        $('#doneStep').hidden = true;
        showPayStep();
      });
      out.appendChild(again);
    }
  } catch (err) {
    notice(out, 'err', esc(err.message));
  }
});

$('#year').textContent = new Date().getFullYear();

api('/api/public/catalog')
  .then((c) => {
    catalog = c;
    renderCatalog();
  })
  .catch(() => notice($('#enrollMsg'), 'err', 'Could not load classes. Please refresh the page.'));
