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
      await withBusy(form.querySelector('button'), () => api(path, { method: 'POST', body: formData(form) }));
      after();
    } catch (err) {
      notice(msg, 'err', esc(err.message));
    }
  });
}

const goNext = () => location.assign(next);
submit($('#loginForm'), '/api/auth/login', goNext);
submit($('#signupForm'), '/api/auth/signup', goNext);
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
