'use strict';
/* Public storefront: prices, enrolment (requires a student account), M-PESA guide. */

let catalog = null;
let me = null; // the logged-in student, or null

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

function renderAuth() {
  $('#enrollGate').hidden = Boolean(me);
  enrollForm.phone.closest('.field-row').hidden = !me;
  if (me) {
    $('#authLink').textContent = 'My dashboard';
    $('#authLink').href = '/account';
    $('#enrollAs').innerHTML = `Enrolling as <strong>${esc(me.name)}</strong> (${esc(me.email)})`;
    if (me.phone && !enrollForm.phone.value) enrollForm.phone.value = `0${me.phone.slice(3)}`;
  }
  updateForm();
}

/** Where to come back to after signing up, with the student's choices kept in the URL. */
function loginUrl(mode) {
  const back = new URLSearchParams({ track: track(), module: enrollForm.module_id.value, class: enrollForm.class_id.value || '' });
  return `/login?${mode === 'signup' ? 'mode=signup&' : ''}next=${encodeURIComponent(`/?${back}#enroll`)}`;
}

/** Restores choices carried through sign-up (see loginUrl). */
function applySavedChoice() {
  const p = new URLSearchParams(location.search);
  if (!p.has('track')) return;
  const radio = enrollForm.querySelector(`input[name=track][value="${CSS.escape(p.get('track'))}"]`);
  if (radio) radio.checked = true;
  if (catalog.modules.some((m) => String(m.id) === p.get('module'))) enrollForm.module_id.value = p.get('module');
  updateForm();
  const opt = [...enrollForm.class_id.options].find((o) => o.value === p.get('class') && !o.disabled);
  if (opt) enrollForm.class_id.value = opt.value;
  syncGateLinks();
  history.replaceState(null, '', '/#enroll');
}

function syncGateLinks() {
  $('#gateSignup').href = loginUrl('signup');
  $('#gateLogin').href = loginUrl('login');
}

function updateForm() {
  if (!catalog) return;
  const t = track();
  const mod = selectedModule();
  $('#classField').hidden = t === 'self';
  if (t !== 'self' && mod) {
    const keep = enrollForm.class_id.value;
    const options = catalog.classes.filter((c) => c.module_id === mod.id && c.mode === t);
    enrollForm.class_id.innerHTML =
      options
        .map((c) => {
          const where = c.mode === 'physical' && c.location ? ` · ${esc(c.location)}` : '';
          return `<option value="${c.id}" ${c.full ? 'disabled' : ''}>${esc(fmtWhen(c.starts_at))} — ${esc(c.title)}${where}${c.full ? ' (full)' : ''}</option>`;
        })
        .join('') + `<option value="">Next available date — we'll email you</option>`;
    // Keep the current choice if it is still offered; otherwise default to the first open class.
    const kept = options.find((c) => String(c.id) === keep && !c.full);
    const firstOpen = options.find((c) => !c.full);
    enrollForm.class_id.value = kept ? kept.id : firstOpen ? firstOpen.id : '';
  }
  const price = mod ? ksh(priceFor(mod, t)) : '—';
  syncGateLinks();
  enrollForm.querySelector('[type=submit]').innerHTML = me
    ? `Continue to payment — KSh ${price}`
    : `Create account to enrol — KSh ${price}`;
}

enrollForm.addEventListener('change', (e) => {
  if (e.target.name === 'track' || e.target.name === 'module_id') updateForm();
  else if (catalog) syncGateLinks();
});

document.querySelectorAll('[data-pick]').forEach((a) =>
  a.addEventListener('click', () => {
    enrollForm.querySelector(`input[value="${a.dataset.pick}"]`).checked = true;
    updateForm();
  })
);

enrollForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!me) return location.assign(loginUrl('signup'));
  const msg = $('#enrollMsg');
  notice(msg);
  try {
    await withBusy(enrollForm.querySelector('button[type=submit]'), () => api('/api/enroll', { method: 'POST', body: formData(enrollForm) }));
    location.assign('/account#payments');
  } catch (err) {
    if (err.status === 401) return location.assign(loginUrl('login'));
    notice(msg, 'err', esc(err.message));
  }
});

$('#year').textContent = new Date().getFullYear();

api('/api/me')
  .then((r) => {
    me = r.student;
  })
  .catch(() => {})
  .finally(renderAuth);

api('/api/public/catalog')
  .then((c) => {
    catalog = c;
    renderCatalog();
    applySavedChoice();
  })
  .catch(() => notice($('#enrollMsg'), 'err', 'Could not load classes. Please refresh the page.'));
