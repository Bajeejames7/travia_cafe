'use strict';
/* Student dashboard: video library, classes, payments, profile. */

const $ = (sel, root = document) => root.querySelector(sel);
const player = $('#player');
let data = null;

const STATUS = {
  awaiting_payment: ['warn', 'Awaiting payment'],
  pending_review: ['info', 'Payment being checked'],
  confirmed: ['ok', 'Confirmed'],
  rejected: ['bad', 'Payment not confirmed'],
};
const statusTag = (s) => `<span class="tag ${STATUS[s][0]}">${STATUS[s][1]}</span>`;

function flash(kind, html) {
  notice($('#flash'), kind, html);
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

// ---------------------------------------------------------------- courses
player.addEventListener('contextmenu', (e) => e.preventDefault());

function play(mi, vi) {
  const m = data.library[mi];
  const v = m.videos[vi];
  player.src = `/api/me/video/${v.id}`;
  $('#nowTitle').textContent = v.title;
  $('#nowModule').textContent = m.title;
  $('#lessonList')
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-current', String(b.dataset.v === String(v.id))));
}

function renderCourses() {
  const lib = data.library;
  $('#library').hidden = !lib.length;
  $('#noCourses').hidden = lib.length > 0;
  if (!lib.length) return;
  $('#lessonList').innerHTML = lib
    .map(
      (m, mi) =>
        `<h3>${esc(m.title)}</h3>` +
        (m.videos.length
          ? m.videos.map((v, vi) => `<button type="button" data-m="${mi}" data-i="${vi}" data-v="${v.id}">${vi + 1}. ${esc(v.title)}</button>`).join('')
          : '<p class="muted small pad">Lessons for this module are being uploaded. Check back soon.</p>')
    )
    .join('');
  $('#lessonList')
    .querySelectorAll('button')
    .forEach((b) => b.addEventListener('click', () => play(+b.dataset.m, +b.dataset.i)));
  const first = lib.findIndex((m) => m.videos.length);
  if (first >= 0 && !player.getAttribute('src')) play(first, 0);
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
function renderClasses() {
  const list = data.enrollments.filter((e) => e.track !== 'self' && e.status !== 'rejected');
  const panel = $('[data-panel="classes"]');
  if (!list.length) {
    panel.innerHTML = `<div class="panel"><h3>No classes booked</h3>
      <p class="muted">Book a live online or in-person session from the enrolment form.</p>
      <a class="btn" href="/#enroll">Book a class</a></div>`;
    return;
  }
  panel.innerHTML = list
    .map((e) => {
      const when = e.starts_at ? `${esc(fmtWhen(e.starts_at))} · ${e.duration_min} min (Nairobi time)` : 'Date to be confirmed — we will email you';
      let action = '';
      if (e.status !== 'confirmed') action = `<p class="small">Your seat is held once payment is confirmed. <a href="#payments" data-goto="payments">Go to payments</a></p>`;
      else if (e.track === 'live')
        action = e.meeting_link
          ? `<a class="btn" href="${esc(e.meeting_link)}" target="_blank" rel="noopener noreferrer">Join class</a>`
          : '<p class="muted small">Your teacher will add the meeting link before class. It will appear here and in your email.</p>';
      else action = `<p class="small">📍 ${esc(e.location || 'Venue will be emailed to you')}<br><span class="muted">Show the code from your confirmation email when you arrive.</span></p>`;
      return `<article class="panel">
        <div class="row"><h3 class="m0">${esc(e.class_title || e.module_title)}</h3><span class="spacer"></span>${statusTag(e.status)}</div>
        <p class="muted small">${esc(TRACK_LABEL[e.track])} · ${esc(e.module_title)} · ${when}</p>
        ${action}
      </article>`;
    })
    .join('');
  panel.querySelectorAll('[data-goto]').forEach((a) =>
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      showTab(a.dataset.goto);
    })
  );
}

// ---------------------------------------------------------------- payments
function renderPayments() {
  const list = data.enrollments;
  const due = list.filter((e) => e.status === 'awaiting_payment' || e.status === 'rejected').length;
  $('#dueCount').hidden = !due;
  $('#dueCount').textContent = due;
  const panel = $('[data-panel="payments"]');
  if (!list.length) {
    panel.innerHTML = '<div class="panel"><p class="muted">No registrations yet.</p><a class="btn" href="/#enroll">Enrol in a module</a></div>';
    return;
  }
  panel.innerHTML = list
    .map((e) => {
      const canPay = e.status !== 'confirmed';
      return `<article class="panel" data-ref="${esc(e.ref)}">
        <div class="row">
          <div><h3 class="m0">${esc(e.module_title)}</h3>
            <div class="muted small">${esc(TRACK_LABEL[e.track])} · Ref <span class="mono">${esc(e.ref)}</span> · KSh ${ksh(e.amount)}</div></div>
          <span class="spacer"></span>${statusTag(e.status)}
        </div>
        ${e.mpesa_code ? `<p class="small m-top">M-PESA code submitted: <span class="mono">${esc(e.mpesa_code)}</span></p>` : ''}
        ${e.reject_reason ? `<p class="small">Reason: ${esc(e.reject_reason)}</p>` : ''}
        ${e.status === 'confirmed' && e.track === 'self' && !e.code_used_at ? '<p class="small">Your unlock code was emailed to you — enter it under <strong>My courses</strong>.</p>' : ''}
        ${
          canPay
            ? `<details class="pay-box" ${e.status === 'awaiting_payment' ? 'open' : ''}>
                <summary>${e.status === 'pending_review' ? 'Correct my M-PESA code' : 'How to pay'}</summary>
                <ol class="steps">${paymentSteps(data.payment, { amount: e.amount, ref: e.ref })}</ol>
                <form class="row" data-pay novalidate>
                  <input name="mpesa_code" class="mono grow" placeholder="M-PESA code, e.g. SJK4H7Q2LM" maxlength="12" autocapitalize="characters" required aria-label="M-PESA code">
                  <button class="btn" type="submit">Submit payment</button>
                </form>
              </details>`
            : ''
        }
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
        flash('ok', 'Payment submitted. We will check it and email your code — usually quickly during working hours.');
      } catch (err) {
        flash('err', esc(err.message));
      }
    })
  );
}

// ---------------------------------------------------------------- profile
function renderProfile() {
  const s = data.student;
  const f = $('#profileForm');
  f.name.value = s.name;
  f.email.value = s.email;
  f.phone.value = s.phone ? `0${s.phone.slice(3)}` : '';
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
  $('#hello').textContent = `Hi, ${data.student.name.split(' ')[0]}`;
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
