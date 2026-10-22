'use strict';
/* Student dashboard: video library, classes, payments (M-PESA prompt or manual code), profile. */

const $ = (sel, root = document) => root.querySelector(sel);
const player = $('#player');
let data = null;
let current = null; // { mi, vi } of the lesson in the player

const STATUS = {
  awaiting_payment: ['warn', 'Awaiting payment'],
  pending_review: ['info', 'Payment being checked'],
  confirmed: ['ok', 'Confirmed'],
  rejected: ['bad', 'Payment not confirmed'],
};
const statusTag = (s) => `<span class="tag ${STATUS[s][0]}">${STATUS[s][1]}</span>`;
const isDue = (e) => e.status === 'awaiting_payment' || e.status === 'rejected';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const localPhone = (p) => (p ? `0${p.slice(3)}` : '');

function flash(kind, html) {
  notice($('#flash'), kind, html);
  if (html) $('#flash').scrollIntoView({ block: 'nearest' });
}

function showTab(id) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== id));
  if (id !== 'courses') player.pause();
  history.replaceState(null, '', `#${id}`);
}
document.querySelectorAll('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    flash();
    showTab(b.dataset.tab);
  })
);
// Any element with data-goto="tab" (stats, banners, links inside cards) switches tabs.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto]');
  if (!el) return;
  e.preventDefault();
  flash();
  showTab(el.dataset.goto);
  $('#tabs').scrollIntoView({ block: 'nearest' });
});

// ---------------------------------------------------------------- summary
function renderSummary() {
  const list = data.enrollments;
  const due = list.filter(isDue);
  const checking = list.filter((e) => e.status === 'pending_review');
  const classes = list.filter((e) => e.track !== 'self' && e.status !== 'rejected' && !hasEnded(e));
  $('#statCourses').textContent = data.library.length;
  $('#statClasses').textContent = classes.length;
  $('#statDue').textContent = due.length;
  $('#statDueBox').classList.toggle('due', due.length > 0);
  $('#dueCount').hidden = !due.length;
  $('#dueCount').textContent = due.length;

  let todo = '';
  if (due.length) {
    todo = `<div class="notice warn todo"><p><strong>${due.length === 1 ? 'One payment' : `${due.length} payments`} to finish.</strong>
      ${due.length === 1 ? `Pay for ${esc(due[0].module_title)} to get access.` : 'Pay to get access to your courses and classes.'}</p>
      <button class="btn small" type="button" data-goto="payments">${data.payment.stk ? 'Pay with M-PESA' : 'See how to pay'}</button></div>`;
  } else if (checking.length) {
    todo = `<div class="notice info todo"><p><strong>We're checking your payment.</strong> We'll email you as soon as it's confirmed.</p></div>`;
  } else if (!list.length) {
    todo = `<div class="notice todo"><p><strong>Welcome!</strong> Pick your first course to get started.</p><a class="btn small" href="/#courses">Browse courses</a></div>`;
  }
  $('#todo').innerHTML = todo;
}

// ---------------------------------------------------------------- courses
player.addEventListener('contextmenu', (e) => e.preventDefault());

/** Lessons in watching order across every unlocked module. */
const allLessons = () => data.library.flatMap((m, mi) => m.videos.map((v, vi) => ({ mi, vi })));

function play(mi, vi) {
  const m = data.library[mi];
  const v = m.videos[vi];
  current = { mi, vi };
  player.src = `/api/me/video/${v.id}`;
  $('#nowTitle').textContent = v.title;
  $('#nowModule').textContent = `${m.title} · lesson ${vi + 1} of ${m.videos.length}`;
  $('#lessonList')
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-current', String(b.dataset.v === String(v.id))));
  const order = allLessons();
  const at = order.findIndex((l) => l.mi === mi && l.vi === vi);
  $('#prevBtn').disabled = at <= 0;
  $('#nextBtn').disabled = at >= order.length - 1;
}

function step(delta) {
  const order = allLessons();
  const at = order.findIndex((l) => current && l.mi === current.mi && l.vi === current.vi);
  const next = order[at + delta];
  if (!next) return;
  play(next.mi, next.vi);
  player.play().catch(() => {});
}
$('#prevBtn').addEventListener('click', () => step(-1));
$('#nextBtn').addEventListener('click', () => step(1));

function renderCourses() {
  const lib = data.library;
  $('#library').hidden = !lib.length;
  $('#noCourses').hidden = lib.length > 0;
  // Older registrations still unlock with an emailed code; open the box when one is waiting.
  $('#redeemBox').open = data.enrollments.some((e) => e.track === 'self' && e.status === 'confirmed' && !e.code_used_at);
  if (!lib.length) return;
  $('#lessonList').innerHTML = lib
    .map(
      (m, mi) =>
        `<h3>${esc(m.title)}</h3>` +
        (m.videos.length
          ? m.videos
              .map((v, vi) => `<button type="button" data-m="${mi}" data-i="${vi}" data-v="${v.id}"><span class="n">${vi + 1}</span><span>${esc(v.title)}</span></button>`)
              .join('')
          : '<p class="muted small pad">Lessons for this course are being uploaded. Check back soon.</p>')
    )
    .join('');
  $('#lessonList')
    .querySelectorAll('button')
    .forEach((b) => b.addEventListener('click', () => play(+b.dataset.m, +b.dataset.i)));
  if (current && lib[current.mi]?.videos[current.vi]) play(current.mi, current.vi);
  else {
    const first = lib.findIndex((m) => m.videos.length);
    if (first >= 0) play(first, 0);
  }
}

$('#redeemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash();
  try {
    const r = await withBusy(e.target.querySelector('button'), () => api('/api/me/redeem', { method: 'POST', body: { code: e.target.code.value } }));
    e.target.reset();
    await load();
    flash('ok', `Unlocked <strong>${esc(r.module)}</strong>. Enjoy the lessons!`);
  } catch (err) {
    flash('err', esc(err.message));
  }
});

// ---------------------------------------------------------------- classes
/** Nairobi time (UTC+3, no DST) in the classes' 'YYYY-MM-DDTHH:MM' format. */
const nowNairobi = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16);
/** A class counts as over once its scheduled length has passed. */
function hasEnded(e) {
  if (!e.starts_at) return false;
  const end = new Date(Date.parse(`${e.starts_at}:00Z`) + (e.duration_min || 60) * 60000).toISOString().slice(0, 16);
  return end < nowNairobi();
}

function renderClasses() {
  // Upcoming classes first (soonest at the top), then the ones that have ended.
  const list = data.enrollments
    .filter((e) => e.track !== 'self' && e.status !== 'rejected')
    .sort((a, b) => hasEnded(a) - hasEnded(b) || String(a.starts_at || '9').localeCompare(String(b.starts_at || '9')));
  const panel = $('[data-panel="classes"]');
  if (!list.length) {
    panel.innerHTML = `<div class="panel"><h3>No classes booked</h3>
      <p class="muted">Book a live online or in-person class from the enrol form.</p>
      <a class="btn" href="/#enroll">Book a class</a></div>`;
    return;
  }
  panel.innerHTML = list
    .map((e) => {
      const d = e.starts_at ? dateParts(e.starts_at) : null;
      const chip = d ? `<div class="date-chip"><b>${esc(d.day)}</b><span>${esc(d.month)}</span></div>` : '<div class="date-chip"><b>?</b><span>TBC</span></div>';
      const when = d ? `${esc(d.weekday)} ${esc(d.day)} ${esc(d.month)}, ${esc(d.time)} · ${e.duration_min} min (Nairobi time)` : 'Date to be confirmed. We will email you.';
      const ended = hasEnded(e);
      let action = '';
      if (ended) action = '<p class="muted small m0">This class has ended.</p>';
      else if (e.status !== 'confirmed') action = `<p class="small m0">Your seat is held once payment is confirmed. <a href="#payments" data-goto="payments">Go to payments</a></p>`;
      else if (e.track === 'live')
        action = e.meeting_link
          ? `<a class="btn" href="${esc(e.meeting_link)}" target="_blank" rel="noopener noreferrer">Join class</a>`
          : '<p class="muted small m0">Your teacher will add the meeting link before class. It will appear here and in your email.</p>';
      else action = `<p class="small m0"><strong>Where:</strong> ${esc(e.location || 'Venue will be emailed to you')}<br><span class="muted">Show the code from your confirmation email when you arrive.</span></p>`;
      return `<article class="panel">
        <div class="when">
          ${chip}
          <div class="grow">
            <div class="row"><h3 class="m0">${esc(e.class_title || e.module_title)}</h3><span class="spacer"></span>${ended ? '<span class="tag">Ended</span>' : statusTag(e.status)}</div>
            <p class="muted small">${esc(TRACK_LABEL[e.track])} · ${esc(e.module_title)}<br>${when}</p>
            ${action}
          </div>
        </div>
      </article>`;
    })
    .join('');
}

// ---------------------------------------------------------------- payments
function manualPayBox(e, open) {
  const label = e.status === 'pending_review' ? 'Correct my M-PESA code' : data.payment.stk ? 'Pay from the M-PESA menu instead' : 'How to pay';
  return `<details class="pay-box" ${open ? 'open' : ''}>
    <summary>${label}</summary>
    <ol class="steps">${paymentSteps(data.payment, { amount: e.amount, ref: e.ref })}</ol>
    <form class="row" data-pay novalidate>
      <input name="mpesa_code" class="mono grow" placeholder="M-PESA code, e.g. SJK4H7Q2LM" maxlength="12" autocapitalize="characters" required aria-label="M-PESA code">
      <button class="btn" type="submit">Submit code</button>
    </form>
  </details>`;
}

function stkBox(e) {
  return `<div class="stk">
    <form data-stk novalidate>
      <label class="m0 grow"><span class="sr-only">M-PESA phone number</span>
        <input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(localPhone(data.student.phone))}" placeholder="0712 345 678" required></label>
      <button class="btn" type="submit">Pay KSh ${ksh(e.amount)} with M-PESA</button>
    </form>
    <p class="muted small m0 m-top">We'll send a prompt to this phone. Enter your M-PESA PIN to pay. Nothing to type here afterwards.</p>
  </div>`;
}

function renderPayments() {
  const list = data.enrollments;
  const panel = $('[data-panel="payments"]');
  if (!list.length) {
    panel.innerHTML = '<div class="panel"><p class="muted">No registrations yet.</p><a class="btn" href="/#enroll">Enrol in a course</a></div>';
    return;
  }
  panel.innerHTML = list
    .map((e) => {
      const due = isDue(e);
      let body = '';
      if (e.status === 'confirmed') {
        body =
          e.track === 'self'
            ? e.code_used_at
              ? '<p class="small m-top m0">Paid. Your videos are in <a href="#courses" data-goto="courses">My courses</a>.</p>'
              : '<p class="small m-top m0">Paid. Your unlock code was emailed to you. Enter it under <a href="#courses" data-goto="courses">My courses</a>.</p>'
            : '<p class="small m-top m0">Paid. Your class ticket code was emailed to you. See <a href="#classes" data-goto="classes">Classes</a>.</p>';
      } else if (e.status === 'pending_review') {
        body = `<p class="small m-top m0">We're checking M-PESA code <span class="mono">${esc(e.mpesa_code)}</span>. You'll get an email once it's confirmed.</p>${manualPayBox(e, false)}`;
      } else {
        body = (data.payment.stk ? stkBox(e) : '') + manualPayBox(e, !data.payment.stk && due);
      }
      return `<article class="panel" data-ref="${esc(e.ref)}" data-amount="${e.amount}">
        <div class="pay-head">
          <div class="grow">
            <h3 class="m0">${esc(e.module_title)}</h3>
            <div class="muted small">${esc(TRACK_LABEL[e.track])} · Ref ${copyBtn(e.ref)}</div>
          </div>
          <div class="center"><div class="amt">KSh ${ksh(e.amount)}</div>${statusTag(e.status)}</div>
        </div>
        ${e.reject_reason ? `<p class="small m-top m0"><strong>Why:</strong> ${esc(e.reject_reason)}</p>` : ''}
        ${body}
      </article>`;
    })
    .join('');

  panel.querySelectorAll('form[data-pay]').forEach((f) =>
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      flash();
      const ref = f.closest('[data-ref]').dataset.ref;
      try {
        await withBusy(f.querySelector('button'), () =>
          api(`/api/me/enrollments/${encodeURIComponent(ref)}/payment`, { method: 'POST', body: formData(f) })
        );
        await load();
        flash('ok', 'Code submitted. We will check it and email you once it is confirmed, usually quickly during working hours.');
      } catch (err) {
        flash('err', esc(err.message));
      }
    })
  );
  panel.querySelectorAll('form[data-stk]').forEach((f) => f.addEventListener('submit', (ev) => startPrompt(ev, f)));
}

/** Sends the M-PESA PIN prompt, then waits for PayHero's answer. */
async function startPrompt(ev, form) {
  ev.preventDefault();
  flash();
  const card = form.closest('[data-ref]');
  const ref = card.dataset.ref;
  const box = form.closest('.stk');
  try {
    await withBusy(form.querySelector('button'), () =>
      api(`/api/me/enrollments/${encodeURIComponent(ref)}/stk`, { method: 'POST', body: { phone: form.phone.value } })
    );
  } catch (err) {
    return flash('err', esc(err.message));
  }
  const to = data.payment.account_name ? ` to <strong>${esc(data.payment.account_name)}</strong>` : '';
  box.innerHTML = `<div class="waiting"><span class="pulse" aria-hidden="true"></span>
    <div><strong>Check your phone</strong><div class="muted small">Enter your M-PESA PIN on the prompt to pay KSh ${ksh(card.dataset.amount)}${to}. This page updates by itself.</div></div></div>`;
  await waitForPrompt(ref);
}

async function waitForPrompt(ref) {
  const started = Date.now();
  for (;;) {
    await sleep(3000);
    let r;
    try {
      r = await api(`/api/me/enrollments/${encodeURIComponent(ref)}/stk`);
    } catch {
      if (Date.now() - started > 150000) break;
      continue; // a dropped connection on a phone is normal; keep waiting
    }
    if (r.enrollment === 'confirmed' || r.status === 'success') {
      await load();
      const e = data.enrollments.find((x) => x.ref === ref);
      if (e && e.track === 'self' && e.code_used_at) {
        showTab('courses');
        return flash('ok', '<strong>Payment received.</strong> Your videos are unlocked. Enjoy the lessons!');
      }
      return flash('ok', '<strong>Payment received.</strong> Your class ticket code has been emailed to you.');
    }
    if (r.status === 'failed') {
      await load();
      return flash('err', 'The payment was cancelled or did not go through. You can try again.');
    }
    if (r.status === 'expired' || Date.now() - started > 150000) break;
  }
  await load();
  flash('warn', "We haven't heard back from M-PESA yet. If you paid, this page will update shortly; refresh in a minute. No prompt? Try again or pay from the M-PESA menu.");
}

// ---------------------------------------------------------------- profile
function renderProfile() {
  const s = data.student;
  const f = $('#profileForm');
  f.name.value = s.name;
  f.email.value = s.email;
  f.phone.value = localPhone(s.phone);
  $('#googleNote').hidden = !(s.google && !s.has_password);
  $('#currentPw').hidden = !s.has_password;
  $('#pwTitle').textContent = s.has_password ? 'Change password' : 'Set a password';
  $('#deviceNote').textContent = `For security, your account can be signed in on up to ${data.max_devices} devices at a time. Signing in on another device signs out the oldest one.`;
}

$('#profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash();
  try {
    await withBusy(e.target.querySelector('button'), () =>
      api('/api/me', { method: 'PUT', body: { name: e.target.name.value, phone: e.target.phone.value } })
    );
    await load();
    flash('ok', 'Details saved.');
  } catch (err) {
    flash('err', esc(err.message));
  }
});

$('#passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash();
  try {
    await withBusy(e.target.querySelector('button'), () => api('/api/me/password', { method: 'POST', body: formData(e.target) }));
    e.target.reset();
    await load();
    flash('ok', 'Password saved. Other devices have been signed out.');
  } catch (err) {
    flash('err', esc(err.message));
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.assign('/');
});

// ---------------------------------------------------------------- boot
async function load() {
  try {
    data = await api('/api/me');
  } catch (err) {
    if (err.status === 401) return location.replace('/login?next=/account');
    throw err;
  }
  // The email must be confirmed before the dashboard opens; the log-in page asks for the code.
  if (!data.verified) return location.replace(`/login?verify=1&next=${encodeURIComponent(`/account${location.hash}`)}`);
  $('#hello').textContent = `Hi, ${data.student.name.split(' ')[0]}`;
  renderSummary();
  renderCourses();
  renderClasses();
  renderPayments();
  renderProfile();
}

const TAB_IDS = ['courses', 'classes', 'payments', 'profile'];
const tabFromHash = () => (TAB_IDS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'courses');
window.addEventListener('hashchange', () => showTab(tabFromHash()));
showTab(tabFromHash());
load().catch(() => flash('err', 'Could not load your dashboard. Please refresh.'));
