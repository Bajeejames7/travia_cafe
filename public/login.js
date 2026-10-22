'use strict';
/* Student log in, sign up, Google sign-in and password reset. */

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const msg = $('#authMsg');

// Only same-site paths are allowed as a destination after logging in. Resolving through URL matters:
// browsers drop tabs and newlines, so a raw check would let "/\t/evil.example" through as "//evil.example".
function safeNext(raw) {
  try {
    const u = new URL(raw || '/account', location.origin);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : '/account';
  } catch {
    return '/account';
  }
}
const next = safeNext(params.get('next'));

const ERRORS = {
  google_off: 'Google sign-in is not set up yet. Please use your email and password.',
  google_failed: 'Google sign-in did not complete. Please try again.',
  google_unverified: 'Your Google account email is not verified.',
  disabled: 'This account has been disabled. Please contact us.',
};
if (ERRORS[params.get('error')]) notice(msg, 'err', ERRORS[params.get('error')]);

function setMode(mode) {
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $('#loginForm').hidden = mode !== 'login';
  $('#signupForm').hidden = mode !== 'signup';
  notice(msg);
}

// Show/hide password, so nobody has to retype a long password they mistyped on a phone.
document.querySelectorAll('.pw-wrap input').forEach((input) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-toggle';
  btn.textContent = 'Show';
  btn.setAttribute('aria-label', 'Show password');
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });
  input.after(btn);
});
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
if (params.get('mode') === 'signup') setMode('signup');

$('#googleBtn').href = `/auth/google?next=${encodeURIComponent(next)}`;
api('/api/auth/config')
  .then((c) => {
    $('#googleBtn').hidden = !c.google;
    $('#googleDivider').hidden = !c.google;
  })
  .catch(() => {});

function submit(form, path, after) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    notice(msg);
    try {
      const r = await withBusy(form.querySelector('button[type=submit]'), () => api(path, { method: 'POST', body: formData(form) }));
      after(r);
    } catch (err) {
      notice(msg, 'err', esc(err.message));
    }
  });
}

const goNext = () => location.assign(next);
/** After logging in or signing up: accounts whose email is not confirmed yet go to the code screen. */
const afterAuth = (r) => (r && r.verified === false ? showVerify(r.email, r.mail) : goNext());
submit($('#loginForm'), '/api/auth/login', afterAuth);
submit($('#signupForm'), '/api/auth/signup', afterAuth);
submit($('#forgotForm'), '/api/auth/forgot', () =>
  notice(msg, 'ok', 'If an account exists for that email, a reset link is on its way. Check your inbox (and spam).')
);

$('#forgotLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#authMain').hidden = true;
  $('#forgotForm').hidden = false;
  notice(msg);
});

const resetToken = params.get('reset');
if (resetToken) {
  $('#authMain').hidden = true;
  $('#resetForm').hidden = false;
  $('#resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    notice(msg);
    try {
      await withBusy(e.target.querySelector('button'), () =>
        api('/api/auth/reset', { method: 'POST', body: { token: resetToken, password: e.target.password.value } })
      );
      location.assign('/account');
    } catch (err) {
      notice(msg, 'err', esc(err.message));
    }
  });
}

// ---------------------------------------------------------------- email typos
// Common providers, so "amina@gmial.com" gets a "Did you mean amina@gmail.com?" before a code goes nowhere.
const KNOWN_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'ymail.com', 'aol.com',
  'protonmail.com', 'proton.me', 'msn.com', 'me.com', 'yahoo.co.uk', 'mail.com', 'gmx.com', 'zoho.com',
];
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}
function suggestEmail(value) {
  const m = /^([^\s@]+)@([^\s@]+)$/.exec(value.trim().toLowerCase());
  if (!m || KNOWN_DOMAINS.includes(m[2])) return '';
  let best = '';
  let bestD = 3; // only suggest for one or two typos
  for (const d of KNOWN_DOMAINS) {
    const dist = distance(m[2], d);
    if (dist < bestD) [best, bestD] = [d, dist];
  }
  return best ? `${m[1]}@${best}` : '';
}
function watchTypos(input, box) {
  input.addEventListener('blur', () => {
    const s = suggestEmail(input.value);
    box.hidden = !s;
    if (s) box.innerHTML = `Did you mean <button type="button" class="linkbtn">${esc(s)}</button>?`;
  });
  input.addEventListener('input', () => (box.hidden = true));
  box.addEventListener('click', (e) => {
    if (!e.target.closest('button')) return;
    input.value = suggestEmail(input.value);
    box.hidden = true;
    input.focus();
  });
}
watchTypos($('#signupForm').email, $('#signupSuggest'));
watchTypos($('#changeEmailForm').email, $('#changeSuggest'));

// ---------------------------------------------------------------- email confirmation
const MAIL_NOTES = {
  failed: ['err', 'We could not send the code to that address. Check it under "Wrong email?", or tap "Send a new code".'],
  logged: ['warn', 'Our email is not working right now, so the code could not be sent. Please contact us and we will confirm your email for you.'],
  active: ['info', 'We already sent you a code. Enter it below, or tap "Send a new code".'],
  wait: ['info', 'We sent you a code a moment ago. Enter it below, or tap "Send a new code" in a minute.'],
  limit: ['warn', 'We have sent several codes already. Use the latest one, or wait an hour and try again.'],
};
let cooldownTimer = null;
function cooldown(seconds = 60) {
  const btn = $('#resendBtn');
  clearInterval(cooldownTimer);
  let left = seconds;
  btn.disabled = true;
  btn.textContent = `Send a new code (${left}s)`;
  cooldownTimer = setInterval(() => {
    left -= 1;
    if (left > 0) btn.textContent = `Send a new code (${left}s)`;
    else {
      clearInterval(cooldownTimer);
      btn.disabled = false;
      btn.textContent = 'Send a new code';
    }
  }, 1000);
}

function showVerify(address, mailStatus) {
  ['#authMain', '#forgotForm', '#resetForm'].forEach((s) => ($(s).hidden = true));
  $('#verifyView').hidden = false;
  $('#verifyEmail').textContent = address;
  $('#changeEmailForm').email.value = address;
  const note = MAIL_NOTES[mailStatus];
  notice(msg, note ? note[0] : '', note ? note[1] : '');
  if (mailStatus === 'sent' || mailStatus === 'active') cooldown(mailStatus === 'sent' ? 60 : 20);
  $('#verifyForm').code.focus();
}

const codeInput = $('#verifyForm').code;
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
  if (codeInput.value.length === 6) $('#verifyForm').requestSubmit();
});
$('#verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  notice(msg);
  if (codeInput.value.length !== 6) return notice(msg, 'err', 'Enter the 6-digit code from the email.');
  try {
    await withBusy(e.target.querySelector('button'), () => api('/api/me/verify', { method: 'POST', body: { code: codeInput.value } }));
    notice(msg, 'ok', 'Email confirmed. Taking you on…');
    goNext();
  } catch (err) {
    if (err.status === 401) return location.reload();
    codeInput.select();
    notice(msg, 'err', esc(err.message));
  }
});

$('#resendBtn').addEventListener('click', async (e) => {
  notice(msg);
  try {
    const r = await withBusy(e.target, () => api('/api/me/verify/resend', { method: 'POST' }));
    if (r.verified) return goNext();
    const note = MAIL_NOTES[r.mail];
    notice(msg, note ? note[0] : 'ok', note ? note[1] : `New code sent to ${esc($('#verifyEmail').textContent)}.`);
    cooldown();
  } catch (err) {
    notice(msg, 'err', esc(err.message));
  }
});

$('#changeEmailBtn').addEventListener('click', () => {
  const box = $('#changeEmailForm');
  box.hidden = !box.hidden;
  if (!box.hidden) box.email.focus();
});
$('#changeEmailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  notice(msg);
  try {
    const r = await withBusy(e.target.querySelector('button'), () => api('/api/me/email', { method: 'POST', body: formData(e.target) }));
    $('#verifyEmail').textContent = r.email;
    e.target.hidden = true;
    const note = MAIL_NOTES[r.mail];
    notice(msg, note ? note[0] : 'ok', note ? note[1] : `Code sent to ${esc(r.email)}.`);
    cooldown();
    codeInput.value = '';
    codeInput.focus();
  } catch (err) {
    notice(msg, 'err', esc(err.message));
  }
});

$('#verifyLogout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.assign('/login');
});

// Sent here from the dashboard or the enrol form with an unconfirmed email: pick up where they left off.
if (params.get('verify')) {
  api('/api/me')
    .then((r) => (r.verified ? goNext() : showVerify(r.student.email)))
    .catch(() => {});
}
