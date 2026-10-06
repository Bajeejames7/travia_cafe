'use strict';
/* Staff dashboard. Admins: payments, prices, videos, settings, staff. Teachers: classes and check-in. */

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
let me = null;
let options = { modules: [], teachers: [] };
let activeTab = null;

const STATUS_TAG = {
  awaiting_payment: ['warn', 'awaiting payment'],
  pending_review: ['info', 'to review'],
  confirmed: ['ok', 'confirmed'],
  rejected: ['bad', 'rejected'],
};
const statusTag = (s) => {
  const [k, t] = STATUS_TAG[s] || ['', s];
  return `<span class="tag ${k}">${esc(t)}</span>`;
};
const MODE_TAG = { live: '<span class="tag info">live online</span>', physical: '<span class="tag ok">in person</span>' };
const fmtStamp = (iso) => (iso ? new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

function flash(kind, html) {
  notice($('#flash'), kind, html);
  if (html) $('#flash').scrollIntoView({ block: 'nearest' });
}

/** Runs an action, reporting errors in the flash area. */
async function act(button, fn) {
  flash();
  try {
    return await (button ? withBusy(button, fn) : fn());
  } catch (err) {
    if (err.status === 401) return boot();
    flash('err', esc(err.message));
  }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const TABS = [
  { id: 'payments', label: 'Payments', admin: true, render: renderPayments },
  { id: 'classes', label: 'Classes', render: renderClasses },
  { id: 'checkin', label: 'Check-in', render: renderCheckin },
  { id: 'modules', label: 'Modules & prices', admin: true, render: renderModules },
  { id: 'videos', label: 'Videos', admin: true, render: renderVideos },
  { id: 'settings', label: 'Settings', admin: true, render: renderSettings },
  { id: 'staff', label: 'Staff', admin: true, render: renderStaff },
  { id: 'outbox', label: 'Emails', admin: true, render: renderOutbox },
  { id: 'account', label: 'My account', render: renderAccount },
];

function drawTabs(counts = {}) {
  const tabs = TABS.filter((t) => !t.admin || me.role === 'admin');
  $('#tabs').innerHTML = tabs
    .map((t) => {
      const badge = t.id === 'payments' && counts.pending_review ? `<span class="count">${counts.pending_review}</span>` : '';
      return `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === activeTab}">${esc(t.label)}${badge}</button>`;
    })
    .join('');
  $('#tabs')
    .querySelectorAll('button')
    .forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
}

async function openTab(id) {
  activeTab = id;
  location.hash = id;
  drawTabs(lastCounts);
  flash();
  view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await TABS.find((t) => t.id === id).render();
  } catch (err) {
    if (err.status === 401) return boot();
    view.innerHTML = '';
    flash('err', esc(err.message));
  }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
let paymentFilter = 'pending_review';
let lastCounts = {};

async function renderPayments() {
  const [{ rows, counts }, classes] = await Promise.all([
    api(`/api/admin/enrollments?status=${paymentFilter}`),
    api('/api/staff/classes'),
  ]);
  lastCounts = counts;
  drawTabs(counts);
  const filters = [
    ['pending_review', 'To review'],
    ['awaiting_payment', 'Awaiting payment'],
    ['confirmed', 'Confirmed'],
    ['rejected', 'Rejected'],
    ['all', 'All'],
  ];
  view.innerHTML = `
    <div class="row">
      ${filters
        .map(([k, l]) => `<button class="btn small ${k === paymentFilter ? '' : 'ghost'}" data-filter="${k}">${l}${counts[k] ? ` (${counts[k]})` : ''}</button>`)
        .join('')}
    </div>
    <p class="muted small">Check every M-PESA code against the SMS on the business phone (amount and sender) before confirming.
      Confirming emails the student their one-time code.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Submitted</th><th>Student</th><th>Choice</th><th class="num">Amount</th><th>M-PESA</th><th>Status</th><th></th></tr></thead>
      <tbody>${
        rows.length
          ? rows.map((r) => paymentRow(r, classes)).join('')
          : '<tr><td colspan="7" class="muted">Nothing here.</td></tr>'
      }</tbody>
    </table></div>`;

  view.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      paymentFilter = b.dataset.filter;
      openTab('payments');
    })
  );
  view.querySelectorAll('[data-confirm]').forEach((b) =>
    b.addEventListener('click', () =>
      act(b, async () => {
        const r = await api(`/api/admin/enrollments/${b.dataset.confirm}/confirm`, { method: 'POST' });
        await renderPayments();
        flash('ok', codeNotice('Payment confirmed.', r));
      })
    )
  );
  view.querySelectorAll('[data-reissue]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!confirm('Send a new code? The old code stops working and any device using it loses access.')) return;
      act(b, async () => {
        const r = await api(`/api/admin/enrollments/${b.dataset.reissue}/reissue`, { method: 'POST' });
        await renderPayments();
        flash('ok', codeNotice('New code issued.', r));
      });
    })
  );
  view.querySelectorAll('[data-reject]').forEach((b) =>
    b.addEventListener('click', () => {
      const reason = prompt('Reason (sent to the student). e.g. "No payment found with that code" — leave blank for none:');
      if (reason === null) return;
      act(b, async () => {
        await api(`/api/admin/enrollments/${b.dataset.reject}/reject`, { method: 'POST', body: { reason } });
        await renderPayments();
        flash('ok', 'Marked as rejected and the student was emailed.');
      });
    })
  );
  view.querySelectorAll('select[data-move]').forEach((s) =>
    s.addEventListener('change', () =>
      act(null, async () => {
        await api(`/api/admin/enrollments/${s.dataset.move}/class`, { method: 'PUT', body: { class_id: s.value || null } });
        flash('ok', 'Class updated. Use "Send link" on the Classes tab to email the new link if needed.');
      })
    )
  );
}

function codeNotice(title, r) {
  const mail =
    r.mail === 'sent'
      ? 'Emailed to the student.'
      : r.mail === 'failed'
        ? '<strong>The email failed</strong> — send the code to the student by SMS/WhatsApp.'
        : '<strong>Email is not configured</strong> — send the code to the student by SMS/WhatsApp.';
  return `${title} Code: <span class="code-out">${esc(r.code)}</span><br>${mail}`;
}

function paymentRow(r, classes) {
  let classCell = '';
  if (r.track !== 'self') {
    const opts = classes.filter((c) => c.module_id === r.module_id && c.mode === r.track);
    if (r.class_id && !opts.some((c) => c.id === r.class_id)) {
      opts.unshift({ id: r.class_id, title: r.class_title || 'Past class', starts_at: r.class_starts_at });
    }
    classCell = `<select data-move="${r.id}" aria-label="Class">
      <option value="">— no class yet —</option>
      ${opts.map((c) => `<option value="${c.id}" ${c.id === r.class_id ? 'selected' : ''}>${esc(fmtWhen(c.starts_at))} ${esc(c.title)}</option>`).join('')}
    </select>`;
  }
  const actions = [];
  if (r.status !== 'confirmed') actions.push(`<button class="btn small" data-confirm="${r.id}">Confirm</button>`);
  if (r.status === 'confirmed') actions.push(`<button class="btn small ghost" data-reissue="${r.id}">New code</button>`);
  if (r.status !== 'rejected') actions.push(`<button class="btn small danger" data-reject="${r.id}">Reject</button>`);
  const used = r.code_used_at ? `<div class="muted small">code used ${esc(fmtStamp(r.code_used_at))}</div>` : '';
  return `<tr>
    <td class="small">${esc(fmtStamp(r.paid_at || r.created_at))}<div class="muted mono">${esc(r.ref)}</div></td>
    <td><strong>${esc(r.name)}</strong><div class="muted small">${esc(r.email)}<br>${esc(r.phone)}</div></td>
    <td>${esc(r.module_title)}<div class="muted small">${esc(TRACK_LABEL[r.track])}</div>${classCell}</td>
    <td class="num">KSh ${ksh(r.amount)}</td>
    <td class="mono">${esc(r.mpesa_code || '—')}</td>
    <td>${statusTag(r.status)}${used}${r.reject_reason ? `<div class="muted small">${esc(r.reject_reason)}</div>` : ''}</td>
    <td><div class="actions">${actions.join('')}</div></td>
  </tr>`;
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------
let classScope = 'upcoming';

async function renderClasses() {
  options = await api('/api/staff/options');
  const classes = await api(`/api/staff/classes?scope=${classScope === 'past' ? 'past' : 'upcoming'}`);
  view.innerHTML = `
    <details class="panel" id="classFormBox">
      <summary id="classFormTitle">Schedule a class</summary>
      <form id="classForm" novalidate>
        <input type="hidden" name="id">
        <div class="field-row">
          <label>Module <select name="module_id">${options.modules
            .map((m) => `<option value="${m.id}">${esc(m.title)}${m.active ? '' : ' (hidden)'}</option>`)
            .join('')}</select></label>
          <label>Type <select name="mode"><option value="live">Live online</option><option value="physical">In person</option></select></label>
          <label>Title (optional) <input name="title" maxlength="150" placeholder="defaults to the module name"></label>
        </div>
        <div class="field-row">
          <label>Starts (Nairobi time) <input name="starts_at" type="datetime-local" required></label>
          <label>Duration (minutes) <input name="duration_min" type="number" min="15" max="600" value="90"></label>
          <label>Seats (0 = unlimited) <input name="capacity" type="number" min="0" value="0"></label>
          ${
            me.role === 'admin'
              ? `<label>Teacher <select name="teacher_id">${options.teachers
                  .map((t) => `<option value="${t.id}" ${t.id === me.id ? 'selected' : ''}>${esc(t.name)}</option>`)
                  .join('')}</select></label>`
              : ''
          }
        </div>
        <label data-for="live">Meeting link (Google Meet, Zoom, Teams…) — only sent to paid students
          <input name="meeting_link" type="url" placeholder="https://meet.google.com/abc-defg-hij"></label>
        <label data-for="physical" hidden>Venue / address <input name="location" maxlength="300"></label>
        <div class="row">
          <button class="btn" type="submit">Save class</button>
          <button class="btn ghost" type="button" id="classCancel">Cancel</button>
        </div>
      </form>
    </details>
    <div class="row">
      <button class="btn small ${classScope === 'upcoming' ? '' : 'ghost'}" data-scope="upcoming">Upcoming</button>
      <button class="btn small ${classScope === 'past' ? '' : 'ghost'}" data-scope="past">Past</button>
    </div>
    ${classes.length ? classes.map(classCard).join('') : '<p class="muted">No classes here yet.</p>'}`;

  const form = $('#classForm');
  if (!options.modules.length) {
    form.innerHTML = '<p class="muted">Create a module first (Modules &amp; prices tab).</p>';
  }
  const syncMode = () => {
    form.querySelectorAll('[data-for]').forEach((el) => (el.hidden = el.dataset.for !== form.mode.value));
  };
  if (form.mode) {
    form.mode.addEventListener('change', syncMode);
    $('#classCancel').addEventListener('click', () => {
      form.reset();
      form.id.value = '';
      $('#classFormTitle').textContent = 'Schedule a class';
      $('#classFormBox').open = false;
      syncMode();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = formData(form);
      act(form.querySelector('[type=submit]'), async () => {
        if (data.id) await api(`/api/staff/classes/${data.id}`, { method: 'PUT', body: data });
        else await api('/api/staff/classes', { method: 'POST', body: data });
        await renderClasses();
        flash('ok', data.id ? 'Class updated.' : 'Class scheduled. Students can now pick it when they enrol.');
      });
    });
  }

  view.querySelectorAll('[data-scope]').forEach((b) =>
    b.addEventListener('click', () => {
      classScope = b.dataset.scope;
      renderClasses();
    })
  );

  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  view.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = byId[b.dataset.edit];
      for (const k of ['id', 'module_id', 'mode', 'title', 'starts_at', 'duration_min', 'capacity', 'meeting_link', 'location', 'teacher_id']) {
        if (form[k] && c[k] != null) form[k].value = c[k];
      }
      syncMode();
      $('#classFormTitle').textContent = `Edit: ${c.title}`;
      $('#classFormBox').open = true;
      $('#classFormBox').scrollIntoView();
    })
  );
  view.querySelectorAll('[data-roster]').forEach((b) =>
    b.addEventListener('click', () =>
      act(b, async () => {
        const box = $(`#roster-${b.dataset.roster}`);
        if (!box.hidden) return (box.hidden = true);
        const rows = await api(`/api/staff/classes/${b.dataset.roster}/roster`);
        box.hidden = false;
        box.innerHTML = rows.length
          ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Phone</th><th>Status</th><th>Link sent</th><th>Checked in</th></tr></thead><tbody>${rows
              .map(
                (r) => `<tr><td>${esc(r.name)}<div class="muted small">${esc(r.email)}</div></td><td>${esc(r.phone)}</td>
                  <td>${statusTag(r.status)}</td><td class="small">${esc(fmtStamp(r.link_sent_at)) || '—'}</td>
                  <td class="small">${esc(fmtStamp(r.code_used_at)) || '—'}</td></tr>`
              )
              .join('')}</tbody></table></div>`
          : '<p class="muted">No students booked yet.</p>';
      })
    )
  );
  view.querySelectorAll('[data-links]').forEach((b) =>
    b.addEventListener('click', () => {
      const all = b.dataset.all === '1';
      if (all && !confirm('Email the meeting link to every paid student on this class, including those who already got it?')) return;
      act(b, async () => {
        const r = await api(`/api/staff/classes/${b.dataset.links}/send-links`, { method: 'POST', body: { only_new: !all } });
        await renderClasses();
        flash('ok', r.sent ? `Meeting link emailed to ${r.sent} student(s).` : 'Everyone confirmed already has the link.');
      });
    })
  );
  view.querySelectorAll('[data-message]').forEach((b) =>
    b.addEventListener('click', () => {
      const box = $(`#msg-${b.dataset.message}`);
      box.hidden = !box.hidden;
    })
  );
  view.querySelectorAll('form[data-msgform]').forEach((f) =>
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      act(f.querySelector('button'), async () => {
        const r = await api(`/api/staff/classes/${f.dataset.msgform}/message`, { method: 'POST', body: formData(f) });
        f.reset();
        f.hidden = true;
        flash('ok', `Message emailed to ${r.sent} student(s).`);
      });
    })
  );
  view.querySelectorAll('[data-delclass]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!confirm('Delete this class?')) return;
      act(b, async () => {
        await api(`/api/staff/classes/${b.dataset.delclass}`, { method: 'DELETE' });
        await renderClasses();
        flash('ok', 'Class deleted.');
      });
    })
  );
  syncMode();
}

function classCard(c) {
  const seats = c.capacity ? `${c.confirmed}/${c.capacity} paid` : `${c.confirmed} paid`;
  const live = c.mode === 'live';
  const linkInfo = live
    ? c.meeting_link
      ? `<a href="${esc(c.meeting_link)}" target="_blank" rel="noopener noreferrer">${esc(c.meeting_link)}</a>`
      : '<span class="tag warn">no meeting link yet</span>'
    : esc(c.location || 'Venue not set');
  return `<article class="panel">
    <div class="row">
      <div>
        <h3 style="margin:0">${esc(c.title)}</h3>
        <div class="muted small">${MODE_TAG[c.mode]} ${esc(fmtWhen(c.starts_at))} · ${c.duration_min} min · ${esc(c.module_title)} · ${esc(c.teacher_name || 'no teacher')}</div>
      </div>
      <span class="spacer"></span>
      <span class="small">${seats}${c.pending ? ` · ${c.pending} unpaid` : ''} · ${c.checked_in} checked in</span>
    </div>
    <p class="small" style="margin:10px 0">${linkInfo}</p>
    <div class="actions">
      <button class="btn small ghost" data-roster="${c.id}">Students</button>
      ${live ? `<button class="btn small" data-links="${c.id}">Send link to new students</button>` : ''}
      ${live ? `<button class="btn small ghost" data-links="${c.id}" data-all="1">Resend to all</button>` : ''}
      <button class="btn small ghost" data-message="${c.id}">Email students</button>
      <button class="btn small ghost" data-edit="${c.id}">Edit</button>
      ${me.role === 'admin' || c.teacher_id === me.id ? `<button class="btn small danger" data-delclass="${c.id}">Delete</button>` : ''}
    </div>
    <form data-msgform="${c.id}" id="msg-${c.id}" hidden style="margin-top:14px">
      <label>Subject <input name="subject" maxlength="150" required></label>
      <label>Message <textarea name="body" maxlength="5000" required></textarea></label>
      <button class="btn small" type="submit">Send to paid students</button>
    </form>
    <div id="roster-${c.id}" hidden style="margin-top:14px"></div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------
async function renderCheckin() {
  view.innerHTML = `
    <div class="panel" style="max-width:520px">
      <h3>Check a student in</h3>
      <p class="muted small">Ask the student for the one-time code from their confirmation email. Each code can check in once.</p>
      <form id="checkinForm" novalidate>
        <label>Code <input name="code" class="mono" placeholder="ABCD-2345" autocapitalize="characters" autocomplete="off" required></label>
        <button class="btn" type="submit">Check in</button>
      </form>
      <div id="checkinOut"></div>
    </div>`;
  const form = $('#checkinForm');
  form.code.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#checkinOut');
    const describe = (s) =>
      `<strong>${esc(s.name)}</strong> · ${esc(s.phone)}<br>${esc(s.module)} — ${esc(TRACK_LABEL[s.track])}<br>${esc(s.class)} ${esc(fmtWhen(s.starts_at))}`;
    try {
      const r = await withBusy(form.querySelector('button'), () => api('/api/staff/checkin', { method: 'POST', body: { code: form.code.value } }));
      notice(out, 'ok', `✔ Checked in<br>${describe(r.student)}`);
      form.reset();
      form.code.focus();
    } catch (err) {
      if (err.status === 401) return boot();
      notice(out, 'err', esc(err.message) + (err.data?.student ? `<br>${describe(err.data.student)}` : ''));
    }
  });
}

// ---------------------------------------------------------------------------
// Modules & prices
// ---------------------------------------------------------------------------
async function renderModules() {
  const [mods, s] = await Promise.all([api('/api/admin/modules'), api('/api/admin/settings')]);
  view.innerHTML = `
    <div class="panel">
      <h3>Default prices (KSh)</h3>
      <p class="muted small">Used for new modules. Each module's own prices below are what students actually pay.</p>
      <form id="defaultsForm" class="field-row" novalidate>
        <label>Self-paced, per module <input name="default_price_self" type="number" min="0" value="${esc(s.default_price_self)}"></label>
        <label>Live online, per session <input name="default_price_live" type="number" min="0" value="${esc(s.default_price_live)}"></label>
        <label>In person, per session <input name="default_price_physical" type="number" min="0" value="${esc(s.default_price_physical)}"></label>
      </form>
      <div class="row">
        <button class="btn" id="saveDefaults">Save defaults</button>
        <button class="btn ghost" id="applyDefaults">Apply defaults to every module</button>
      </div>
    </div>

    <div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Module</th><th class="num">Self-paced</th><th class="num">Live</th><th class="num">In person</th><th>Shown</th><th></th></tr></thead>
      <tbody>${
        mods.length
          ? mods
              .map(
                (m) => `<tr data-mod="${m.id}">
          <td><input name="sort" type="number" value="${m.sort}" style="width:70px;min-width:0"></td>
          <td><input name="title" value="${esc(m.title)}" maxlength="150">
              <textarea name="description" rows="2" style="min-height:0;margin-top:6px" placeholder="Short description">${esc(m.description)}</textarea>
              <div class="muted small">${m.video_count} video(s) · ${m.students} paid student(s)</div></td>
          <td class="num"><input name="price_self" type="number" min="0" value="${m.price_self}"></td>
          <td class="num"><input name="price_live" type="number" min="0" value="${m.price_live}"></td>
          <td class="num"><input name="price_physical" type="number" min="0" value="${m.price_physical}"></td>
          <td><input name="active" type="checkbox" ${m.active ? 'checked' : ''} style="width:auto" aria-label="Shown on the website"></td>
          <td><div class="actions"><button class="btn small" data-save>Save</button><button class="btn small danger" data-del>Delete</button></div></td>
        </tr>`
              )
              .join('')
          : '<tr><td colspan="7" class="muted">No modules yet. Add your first one below.</td></tr>'
      }</tbody>
    </table></div>

    <div class="panel">
      <h3>Add a module</h3>
      <form id="newModule" novalidate>
        <div class="field-row">
          <label>Title <input name="title" maxlength="150" required placeholder="e.g. Network Security Basics"></label>
          <label>Description <input name="description" maxlength="2000"></label>
        </div>
        <button class="btn" type="submit">Add module</button>
        <span class="muted small">Prices start at the defaults; change them in the table.</span>
      </form>
    </div>`;

  const defaults = $('#defaultsForm');
  $('#saveDefaults').addEventListener('click', (e) =>
    act(e.target, async () => {
      await api('/api/admin/settings', { method: 'PUT', body: formData(defaults) });
      flash('ok', 'Default prices saved.');
    })
  );
  $('#applyDefaults').addEventListener('click', (e) => {
    if (!confirm('Overwrite the prices of EVERY module with the defaults? Existing registrations keep the price they were quoted.')) return;
    act(e.target, async () => {
      await api('/api/admin/settings', { method: 'PUT', body: formData(defaults) });
      const r = await api('/api/admin/modules/apply-default-prices', { method: 'POST' });
      await renderModules();
      flash('ok', `Updated ${r.updated} module(s).`);
    });
  });
  view.querySelectorAll('tr[data-mod]').forEach((tr) => {
    const id = tr.dataset.mod;
    tr.querySelector('[data-save]').addEventListener('click', (e) =>
      act(e.target, async () => {
        const body = {};
        tr.querySelectorAll('input, textarea').forEach((i) => (body[i.name] = i.type === 'checkbox' ? i.checked : i.value));
        await api(`/api/admin/modules/${id}`, { method: 'PUT', body });
        flash('ok', 'Module saved. New prices apply to new registrations.');
      })
    );
    tr.querySelector('[data-del]').addEventListener('click', (e) => {
      if (!confirm('Delete this module and all its videos? This cannot be undone.')) return;
      act(e.target, async () => {
        await api(`/api/admin/modules/${id}`, { method: 'DELETE' });
        await renderModules();
        flash('ok', 'Module deleted.');
      });
    });
  });
  $('#newModule').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.target.querySelector('button'), async () => {
      await api('/api/admin/modules', { method: 'POST', body: formData(e.target) });
      await renderModules();
      flash('ok', 'Module added.');
    });
  });
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------
async function renderVideos() {
  const [mods, vids] = await Promise.all([api('/api/admin/modules'), api('/api/admin/videos')]);
  view.innerHTML = `
    <div class="panel">
      <h3>Upload a video</h3>
      <p class="muted small">Videos are stored privately on the server. Students can only stream them after redeeming a code
        for that module; there is no public link. Use MP4 (H.264) for the widest phone support.</p>
      ${
        mods.length
          ? `<form id="uploadForm" novalidate>
        <div class="field-row">
          <label>Module <select name="module_id">${mods.map((m) => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select></label>
          <label>Lesson title <input name="title" maxlength="200" placeholder="defaults to the file name"></label>
        </div>
        <label>Video file <input name="file" type="file" accept="video/*" required></label>
        <div class="row"><button class="btn" type="submit">Upload</button><span class="muted small" id="uploadProgress"></span></div>
      </form>`
          : '<p class="muted">Create a module first.</p>'
      }
    </div>
    ${mods
      .map((m) => {
        const list = vids.filter((v) => v.module_id === m.id);
        return `<div class="panel"><h3>${esc(m.title)}</h3>${
          list.length
            ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Title</th><th>Size</th><th></th></tr></thead><tbody>${list
                .map(
                  (v) => `<tr data-vid="${v.id}">
                <td><input name="sort" type="number" value="${v.sort}" style="width:70px;min-width:0"></td>
                <td><input name="title" value="${esc(v.title)}" maxlength="200"><div data-preview></div></td>
                <td class="small">${mb(v.size)}</td>
                <td><div class="actions"><button class="btn small" data-save>Save</button><button class="btn small ghost" data-play>Preview</button><button class="btn small danger" data-del>Delete</button></div></td>
              </tr>`
                )
                .join('')}</tbody></table></div>`
            : '<p class="muted small">No videos yet.</p>'
        }</div>`;
      })
      .join('')}`;

  const form = $('#uploadForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.file.files.length) return flash('err', 'Choose a video file.');
      const btn = form.querySelector('button');
      const progress = $('#uploadProgress');
      btn.disabled = true;
      flash();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/videos');
      xhr.setRequestHeader('X-TC', '1');
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) progress.textContent = `Uploading… ${Math.round((ev.loaded / ev.total) * 100)}%`;
      };
      xhr.onload = async () => {
        btn.disabled = false;
        progress.textContent = '';
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) {
          await renderVideos();
          flash('ok', 'Video uploaded.');
        } else flash('err', esc(data.error || `Upload failed (${xhr.status}).`));
      };
      xhr.onerror = () => {
        btn.disabled = false;
        progress.textContent = '';
        flash('err', 'Upload failed — check your connection.');
      };
      xhr.send(new FormData(form));
    });
  }

  view.querySelectorAll('tr[data-vid]').forEach((tr) => {
    const id = tr.dataset.vid;
    tr.querySelector('[data-save]').addEventListener('click', (e) =>
      act(e.target, async () => {
        await api(`/api/admin/videos/${id}`, { method: 'PUT', body: { title: tr.querySelector('[name=title]').value, sort: tr.querySelector('[name=sort]').value } });
        flash('ok', 'Video saved.');
      })
    );
    tr.querySelector('[data-play]').addEventListener('click', () => {
      const box = tr.querySelector('[data-preview]');
      box.innerHTML = box.innerHTML ? '' : `<video controls preload="metadata" style="width:100%;max-width:420px;margin-top:8px" src="/api/admin/videos/${id}/stream"></video>`;
    });
    tr.querySelector('[data-del]').addEventListener('click', (e) => {
      if (!confirm('Delete this video permanently?')) return;
      act(e.target, async () => {
        await api(`/api/admin/videos/${id}`, { method: 'DELETE' });
        await renderVideos();
        flash('ok', 'Video deleted.');
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function renderSettings() {
  const s = await api('/api/admin/settings');
  const v = (k) => esc(s[k] || '');
  view.innerHTML = `
    <form id="settingsForm" class="stack" novalidate>
      <div class="panel">
        <h3>School</h3>
        <div class="field-row">
          <label>Name <input name="school_name" value="${v('school_name')}" maxlength="100"></label>
          <label>Contact phone <input name="contact_phone" value="${v('contact_phone')}"></label>
          <label>Contact email <input name="contact_email" type="email" value="${v('contact_email')}"></label>
        </div>
        <label>Tagline <input name="tagline" value="${v('tagline')}" maxlength="300"></label>
      </div>
      <div class="panel">
        <h3>M-PESA</h3>
        <div class="field-row">
          <label>How students pay
            <select name="mpesa_method">
              <option value="till" ${s.mpesa_method === 'till' ? 'selected' : ''}>Buy Goods (Till number)</option>
              <option value="paybill" ${s.mpesa_method === 'paybill' ? 'selected' : ''}>Pay Bill (Business number + account)</option>
              <option value="phone" ${s.mpesa_method === 'phone' ? 'selected' : ''}>Send Money (phone number)</option>
            </select>
          </label>
          <label>Till / Paybill / phone number <input name="mpesa_number" value="${v('mpesa_number')}" class="mono"></label>
          <label>Name shown on the M-PESA prompt <input name="mpesa_account_name" value="${v('mpesa_account_name')}"></label>
        </div>
        <p class="muted small">With Pay Bill, students use their registration reference as the account number, which makes matching payments easy.</p>
      </div>
      <div class="panel">
        <h3>Notifications</h3>
        <label>Email me when a student submits a payment <input name="notify_email" type="email" value="${v('notify_email')}" placeholder="you@example.com"></label>
      </div>
      <div><button class="btn" type="submit">Save settings</button></div>
    </form>`;
  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.target.querySelector('[type=submit]'), async () => {
      await api('/api/admin/settings', { method: 'PUT', body: formData(e.target) });
      flash('ok', 'Settings saved.');
    });
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
async function renderStaff() {
  const people = await api('/api/admin/staff');
  view.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${people
        .map(
          (p) => `<tr data-staff="${p.id}">
          <td><strong>${esc(p.name)}</strong><div class="muted small">${esc(p.email)}</div></td>
          <td>${
            p.id === me.id
              ? esc(p.role)
              : `<select name="role"><option value="teacher" ${p.role === 'teacher' ? 'selected' : ''}>teacher</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>admin</option></select>`
          }</td>
          <td>${p.active ? '<span class="tag ok">active</span>' : '<span class="tag bad">disabled</span>'}</td>
          <td>${
            p.id === me.id
              ? '<span class="muted small">you</span>'
              : `<div class="actions"><button class="btn small ghost" data-toggle>${p.active ? 'Disable' : 'Enable'}</button><button class="btn small ghost" data-pw>Reset password</button></div>`
          }</td>
        </tr>`
        )
        .join('')}</tbody>
    </table></div>
    <div class="panel">
      <h3>Add a teacher or admin</h3>
      <p class="muted small">Teachers can schedule classes, send meeting links, email their students and check students in.
        Only admins see payments, prices, videos and settings.</p>
      <form id="newStaff" novalidate>
        <div class="field-row">
          <label>Name <input name="name" required maxlength="100"></label>
          <label>Email <input name="email" type="email" required></label>
          <label>Temporary password <input name="password" type="text" minlength="10" required placeholder="10+ characters"></label>
          <label>Role <select name="role"><option value="teacher">Teacher</option><option value="admin">Admin</option></select></label>
        </div>
        <button class="btn" type="submit">Add</button>
      </form>
    </div>`;
  view.querySelectorAll('tr[data-staff]').forEach((tr) => {
    const id = tr.dataset.staff;
    const role = tr.querySelector('select[name=role]');
    if (role)
      role.addEventListener('change', () =>
        act(null, async () => {
          await api(`/api/admin/staff/${id}`, { method: 'PUT', body: { role: role.value } });
          flash('ok', 'Role updated.');
        })
      );
    tr.querySelector('[data-toggle]')?.addEventListener('click', (e) =>
      act(e.target, async () => {
        await api(`/api/admin/staff/${id}`, { method: 'PUT', body: { active: e.target.textContent === 'Enable' } });
        await renderStaff();
      })
    );
    tr.querySelector('[data-pw]')?.addEventListener('click', (e) => {
      const password = prompt('New password for this person (10+ characters):');
      if (!password) return;
      act(e.target, async () => {
        await api(`/api/admin/staff/${id}`, { method: 'PUT', body: { password } });
        flash('ok', 'Password reset. They have been logged out everywhere.');
      });
    });
  });
  $('#newStaff').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.target.querySelector('button'), async () => {
      await api('/api/admin/staff', { method: 'POST', body: formData(e.target) });
      await renderStaff();
      flash('ok', `Account created. Share the login page (${esc(location.origin + location.pathname)}) and temporary password privately.`);
    });
  });
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------
async function renderOutbox() {
  const rows = await api('/api/admin/outbox');
  const tag = { sent: 'ok', logged: 'warn', failed: 'bad' };
  view.innerHTML = rows.length
    ? rows
        .map(
          (r) => `<details class="panel">
        <summary>${esc(r.subject)} <span class="tag ${tag[r.status]}">${esc(r.status)}</span></summary>
        <div class="muted small">To ${esc(r.to_email)} · ${esc(fmtStamp(r.created_at))}${r.error ? ` · ${esc(r.error)}` : ''}</div>
        <pre class="mail">${esc(r.body)}</pre>
      </details>`
        )
        .join('')
    : '<p class="muted">No emails yet.</p>';
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
async function renderAccount() {
  view.innerHTML = `
    <div class="panel" style="max-width:480px">
      <h3>Change password</h3>
      <form id="pwForm" novalidate>
        <label>Current password <input name="current" type="password" autocomplete="current-password" required></label>
        <label>New password (10+ characters) <input name="next" type="password" autocomplete="new-password" minlength="10" required></label>
        <button class="btn" type="submit">Change password</button>
      </form>
    </div>`;
  $('#pwForm').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.target.querySelector('button'), async () => {
      await api('/api/staff/password', { method: 'POST', body: formData(e.target) });
      e.target.reset();
      flash('ok', 'Password changed. Other devices have been logged out.');
    });
  });
}

// ---------------------------------------------------------------------------
// Boot / login
// ---------------------------------------------------------------------------
async function boot() {
  try {
    me = await api('/api/staff/me');
  } catch {
    me = null;
  }
  $('#loginView').hidden = Boolean(me);
  $('#appView').hidden = !me;
  $('#who').hidden = !me;
  if (!me) return;
  $('#whoName').textContent = `${me.name} · ${me.role}`;
  notice(
    $('#mailWarn'),
    me.mail_configured || me.role !== 'admin' ? '' : 'warn',
    me.mail_configured || me.role !== 'admin'
      ? ''
      : '<strong>Email is not set up.</strong> Codes and links are only saved in the Emails tab, so send them by hand until SMTP is configured (see README).'
  );
  const allowed = TABS.filter((t) => !t.admin || me.role === 'admin').map((t) => t.id);
  const wanted = location.hash.slice(1);
  openTab(allowed.includes(wanted) ? wanted : allowed[0]);
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  notice($('#loginMsg'));
  try {
    await withBusy(e.target.querySelector('button'), () => api('/api/staff/login', { method: 'POST', body: formData(e.target) }));
    e.target.reset();
    boot();
  } catch (err) {
    notice($('#loginMsg'), 'err', esc(err.message));
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/staff/logout', { method: 'POST' }).catch(() => {});
  me = null;
  boot();
});

boot();
