'use strict';
/* Public storefront: courses, enrolment (requires a student account), M-PESA guide. */

let catalog = null;
let me = null; // the logged-in student, or null

const $ = (sel, root = document) => root.querySelector(sel);
const enrollForm = $('#enrollForm');
const PRICE_KEY = { self: 'price_self', live: 'price_live', physical: 'price_physical' };

const track = () => enrollForm.track.value;
const selectedModule = () => catalog.modules.find((m) => String(m.id) === enrollForm.module_id.value);
const priceFor = (mod, t) => (mod ? mod[PRICE_KEY[t]] : null);
const upcoming = (mod, t) => catalog.classes.filter((c) => c.module_id === mod.id && (!t || c.mode === t));

function courseCard(m) {
  const lessons = m.video_count ? `<span class="tag ok">${m.video_count} video lesson${m.video_count === 1 ? '' : 's'}</span>` : '';
  const classes = upcoming(m).length ? `<span class="tag info">${upcoming(m).length} upcoming class${upcoming(m).length === 1 ? '' : 'es'}</span>` : '';
  const from = Math.min(m.price_self, m.price_live, m.price_physical);
  return `<article class="card course">
    <h3>${esc(m.title)}</h3>
    ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ''}
    ${lessons || classes ? `<div class="meta">${lessons}${classes}</div>` : ''}
    <p class="from">from KSh ${ksh(from)}</p>
    <p class="prices">Video ${ksh(m.price_self)} · Live ${ksh(m.price_live)} · In person ${ksh(m.price_physical)}</p>
    <button type="button" class="btn ghost wide" data-course="${m.id}">Enrol</button>
  </article>`;
}

function renderCatalog() {
  const { school, prices, modules, payment } = catalog;
  document.title = `${school.name} — Cybersecurity Courses in Kenya`;
  document.querySelectorAll('[data-school]').forEach((el) => (el.textContent = school.name));
  if (school.tagline) $('[data-tagline]').textContent = school.tagline;
  document.querySelectorAll('[data-devices]').forEach((el) => (el.textContent = school.max_devices));

  // "From" price on each track card = cheapest active module, or the default.
  for (const t of ['self', 'live', 'physical']) {
    const list = modules.map((m) => priceFor(m, t));
    $(`[data-price="${t}"]`).textContent = ksh(list.length ? Math.min(...list) : prices[t]);
  }

  $('#courseList').innerHTML = modules.length ? modules.map(courseCard).join('') : '<div class="empty">New courses are being published. Check back soon.</div>';
  $('#courseList')
    .querySelectorAll('[data-course]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        enrollForm.module_id.value = b.dataset.course;
        updateForm();
        $('#enroll').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      })
    );

  enrollForm.module_id.innerHTML = modules.length
    ? modules.map((m) => `<option value="${m.id}">${esc(m.title)}</option>`).join('')
    : '<option value="">No courses yet</option>';

  $('#payGuide').innerHTML = paymentSteps(payment);
  if (payment.stk) {
    $('#payIntro').innerHTML = 'The quickest way: after you enrol, tap <strong>Pay with M-PESA</strong> in your dashboard and enter your PIN on the prompt that appears on your phone. Or pay from the M-PESA menu:';
    $('[data-pay-blurb]').textContent = 'Pay with the M-PESA prompt on your phone';
    $('[data-faq-speed]').textContent =
      'With the M-PESA prompt, your payment is confirmed within seconds. If you pay from the M-PESA menu instead, we check your code and confirm it, usually quickly during working hours.';
  }

  const contact = [];
  if (school.contact_phone) contact.push(`<a href="tel:${esc(school.contact_phone.replace(/[^\d+]/g, ''))}">${esc(school.contact_phone)}</a>`);
  const wa = whatsappLink(school.contact_phone);
  if (wa) contact.push(`<a href="${wa}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`);
  if (school.contact_email) contact.push(`<a href="mailto:${esc(school.contact_email)}">${esc(school.contact_email)}</a>`);
  $('#contactLine').innerHTML = contact.join(' · ');
  if (contact.length) $('#helpLine').innerHTML = `Call, WhatsApp or email us: ${contact.join(' · ')}`;
  updateForm();
}

function renderAuth() {
  $('#phoneStep').hidden = !me;
  if (me) {
    $('#authLink').textContent = 'Dashboard';
    $('#authLink').href = '/account';
    $('#enrollAs').innerHTML = me.verified
      ? `Enrolling as <strong>${esc(me.name)}</strong> (${esc(me.email)}).`
      : `Confirm your email (<strong>${esc(me.email)}</strong>) to enrol. <a href="${esc(verifyUrl())}">Enter your code</a>`;
    if (me.phone && !enrollForm.phone.value) enrollForm.phone.value = `0${me.phone.slice(3)}`;
  }
  updateForm();
}

/** Where to come back to after signing up, with the student's choices kept in the URL. */
function loginUrl(mode) {
  const back = new URLSearchParams({ track: track(), module: enrollForm.module_id.value, class: enrollForm.class_id.value || '' });
  return `/login?${mode === 'signup' ? 'mode=signup&' : ''}next=${encodeURIComponent(`/?${back}#enroll`)}`;
}

/** The code screen for a signed-in student whose email is not confirmed yet, coming back to this form after. */
function verifyUrl() {
  const back = new URLSearchParams({ track: track(), module: enrollForm.module_id.value, class: enrollForm.class_id.value || '' });
  return `/login?verify=1&next=${encodeURIComponent(`/?${back}#enroll`)}`;
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
  updateSummary();
  history.replaceState(null, '', '/#enroll');
}

function updateForm() {
  if (!catalog) return;
  const t = track();
  const mod = selectedModule();
  $('#classField').hidden = t === 'self';
  $('#phoneNum').textContent = t === 'self' ? '3' : '4';
  if (t !== 'self' && mod) {
    const keep = enrollForm.class_id.value;
    const options = upcoming(mod, t);
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
  updateSummary();
}

function updateSummary() {
  const t = track();
  const mod = selectedModule();
  $('#sumModule').textContent = mod ? mod.title : '—';
  $('#sumTrack').textContent = TRACK_LABEL[t];
  const showWhen = t !== 'self';
  $('#sumWhenLabel').hidden = !showWhen;
  $('#sumWhen').hidden = !showWhen;
  if (showWhen) {
    const cls = mod && catalog.classes.find((c) => String(c.id) === enrollForm.class_id.value);
    $('#sumWhen').textContent = cls ? fmtWhen(cls.starts_at) : 'Next available';
  }
  $('#enrollAmount').textContent = mod ? ksh(priceFor(mod, t)) : '—';
  enrollForm.querySelector('[type=submit]').textContent = !me
    ? 'Create free account & continue'
    : me.verified
      ? 'Continue to payment'
      : 'Confirm email & continue';
  if (!me) {
    $('#enrollAs').innerHTML = `Your free account keeps your videos, class links and receipts in one place. Already have one? <a href="${esc(loginUrl('login'))}">Log in</a>`;
  }
}

enrollForm.addEventListener('change', (e) => {
  if (e.target.name === 'track' || e.target.name === 'module_id') updateForm();
  else if (catalog) updateSummary();
});

document.querySelectorAll('[data-pick]').forEach((a) =>
  a.addEventListener('click', () => {
    enrollForm.querySelector(`input[value="${a.dataset.pick}"]`).checked = true;
    updateForm();
  })
);

enrollForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!catalog || !selectedModule()) return;
  if (!me) return location.assign(loginUrl('signup'));
  if (!me.verified) return location.assign(verifyUrl());
  const msg = $('#enrollMsg');
  notice(msg);
  try {
    await withBusy(enrollForm.querySelector('button[type=submit]'), () => api('/api/enroll', { method: 'POST', body: formData(enrollForm) }));
    location.assign('/account#payments');
  } catch (err) {
    if (err.status === 401) return location.assign(loginUrl('login'));
    if (err.data && err.data.code === 'unverified') return location.assign(verifyUrl());
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

api('/api/auth/config')
  .then((c) => ($('#faqGoogle').hidden = !c.google))
  .catch(() => {});

api('/api/public/catalog')
  .then((c) => {
    catalog = c;
    renderCatalog();
    // The home page terminal (hero-fx.js) lists the real courses.
    window.tcCatalog = c;
    document.dispatchEvent(new CustomEvent('tc:catalog', { detail: c }));
    applySavedChoice();
    // The course list just grew the page, which pushes anchors down; jump back to the one in the URL
    // (e.g. returning to #enroll after creating an account).
    const target = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  })
  .catch(() => {
    $('#courseList').innerHTML = '<div class="empty">Could not load courses. Please refresh the page.</div>';
    notice($('#enrollMsg'), 'err', 'Could not load courses. Please refresh the page.');
  });
