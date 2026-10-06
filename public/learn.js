'use strict';
/* Self-paced video library, unlocked by one-time codes. */

const lessonList = document.getElementById('lessonList');
const player = document.getElementById('player');
let modules = [];

player.addEventListener('contextmenu', (e) => e.preventDefault());

function play(moduleIdx, videoIdx) {
  const m = modules[moduleIdx];
  const v = m.videos[videoIdx];
  player.src = `/api/learn/video/${v.id}`;
  document.getElementById('nowTitle').textContent = v.title;
  document.getElementById('nowModule').textContent = m.title;
  lessonList.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.v === String(v.id))));
}

async function load() {
  const r = await api('/api/learn/me');
  modules = r.modules;
  const hasAny = modules.length > 0;
  document.getElementById('library').hidden = !hasAny;
  document.getElementById('redeemTitle').textContent = hasAny ? 'Unlock another module' : 'Enter your access code';
  if (!hasAny) return;

  lessonList.innerHTML = modules
    .map(
      (m, mi) =>
        `<h3>${esc(m.title)}</h3>` +
        (m.videos.length
          ? m.videos.map((v, vi) => `<button type="button" data-m="${mi}" data-i="${vi}" data-v="${v.id}">${vi + 1}. ${esc(v.title)}</button>`).join('')
          : '<p class="muted small" style="padding:0 16px 12px">Videos for this module are being uploaded. Check back soon.</p>')
    )
    .join('');
  lessonList.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => play(+b.dataset.m, +b.dataset.i)));

  const first = modules.findIndex((m) => m.videos.length);
  if (first >= 0 && !player.src) play(first, 0);
}

document.getElementById('redeemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('redeemMsg');
  notice(msg);
  try {
    const r = await withBusy(e.target.querySelector('button'), () => api('/api/learn/redeem', { method: 'POST', body: { code: e.target.code.value } }));
    e.target.reset();
    notice(msg, 'ok', `Unlocked <strong>${esc(r.module)}</strong>.`);
    await load();
  } catch (err) {
    notice(msg, 'err', esc(err.message));
  }
});

load().catch(() => {});
