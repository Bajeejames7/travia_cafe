'use strict';

const TRACK_LABEL = { self: 'Self-paced (video)', live: 'Live online class', physical: 'In-person class' };

function formatWhen(startsAt, durationMin) {
  if (!startsAt) return 'To be scheduled — we will email you the date';
  const [date, time] = startsAt.split('T');
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${day} at ${time} (Nairobi time), ${durationMin} minutes`;
}

function signoff(s) {
  const contact = [s.contact_phone, s.contact_email].filter(Boolean).join(' / ');
  return `\n\n${s.school_name}${contact ? `\nQuestions? ${contact}` : ''}`;
}

/** Email sent once an admin confirms an M-PESA payment. Carries the one-time code. */
function confirmation({ enrollment: e, module: m, cls, code, settings: s, baseUrl }) {
  const lines = [
    `Hi ${e.name},`,
    '',
    `We have received your payment of KSh ${e.amount} (M-PESA ${e.mpesa_code || 'n/a'}) for:`,
    `  ${m.title} — ${TRACK_LABEL[e.track]}`,
    `  Reference: ${e.ref}`,
    '',
    `Your one-time code: ${code}`,
    '',
  ];

  if (e.track === 'self') {
    lines.push(
      'To start watching:',
      `  1. Open ${baseUrl}/learn on the phone or computer you will study on.`,
      '  2. Enter the code above.',
      '',
      'The code works once and unlocks the videos on that one device. Please do not share it —',
      'if you change devices, contact us and we will issue a new code.'
    );
  } else {
    lines.push(`Class: ${cls ? cls.title : m.title}`, `When:  ${formatWhen(cls && cls.starts_at, cls && cls.duration_min)}`);
    if (e.track === 'physical') {
      lines.push(`Where: ${(cls && cls.location) || 'We will email you the venue'}`, '', 'Show this code to your teacher when you arrive — it is your ticket for this class.');
    } else if (cls && cls.meeting_link) {
      lines.push(`Join:  ${cls.meeting_link}`, '', 'Your teacher may ask for this code when you join, to confirm your seat.');
    } else {
      lines.push('', 'Your teacher will email you the meeting link before the class.', 'Keep this code — your teacher may ask for it when you join.');
    }
  }

  return { subject: `Payment confirmed — your ${s.school_name} code`, text: lines.join('\n') + signoff(s) };
}

function rejection({ enrollment: e, module: m, reason, settings: s, baseUrl }) {
  const text = [
    `Hi ${e.name},`,
    '',
    `We could not confirm your payment for ${m.title} (reference ${e.ref}).`,
    reason ? `Reason: ${reason}` : '',
    '',
    `If you think this is a mistake, reply to this email or resubmit your M-PESA code at ${baseUrl}/#resume.`,
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  return { subject: `${s.school_name}: we could not confirm your payment`, text: text + signoff(s) };
}

function meetingLink({ enrollment: e, cls, settings: s }) {
  const text = [
    `Hi ${e.name},`,
    '',
    `Here is the link for your live class:`,
    '',
    `Class: ${cls.title}`,
    `When:  ${formatWhen(cls.starts_at, cls.duration_min)}`,
    `Join:  ${cls.meeting_link}`,
    '',
    'Please join a few minutes early. Do not share this link.',
  ].join('\n');
  return { subject: `Your class link: ${cls.title}`, text: text + signoff(s) };
}

function classMessage({ enrollment: e, subject, body, settings: s }) {
  return { subject, text: `Hi ${e.name},\n\n${body}` + signoff(s) };
}

function paymentToReview({ enrollment: e, module: m, baseUrl, staffPath }) {
  return {
    subject: `New M-PESA payment to review: ${e.ref}`,
    text: [
      `${e.name} (${e.email}, ${e.phone}) says they paid KSh ${e.amount}.`,
      `M-PESA code: ${e.mpesa_code}`,
      `For: ${m.title} — ${TRACK_LABEL[e.track]}`,
      '',
      `Check it against your M-PESA messages, then confirm it at ${baseUrl}${staffPath}`,
    ].join('\n'),
  };
}

module.exports = { TRACK_LABEL, formatWhen, confirmation, rejection, meetingLink, classMessage, paymentToReview };
