'use strict';
/**
 * Loads demo data so a fresh clone has something to click through:
 * modules with sample videos, a teacher, upcoming classes and students in every payment state.
 *
 *   npm run seed
 *
 * Logins: the admin comes from ADMIN_EMAIL / ADMIN_PASSWORD. The teacher and demo student use
 * DEMO_TEACHER_PASSWORD / DEMO_STUDENT_PASSWORD if set, otherwise random passwords printed below.
 */
try {
  process.loadEnvFile();
} catch {
  // no .env file
}
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, init, VIDEO_DIR, setSettings } = require('../src/db');
const { ensureAdmin } = require('../src/admin');
const { hashPassword, randomChars, newAccessCode } = require('../src/security');

if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  console.error('Refusing to load demo accounts into a production database (NODE_ENV=production).');
  process.exit(1);
}

/** 'YYYY-MM-DDTHH:MM' in Nairobi time, `days` from today. Keeps demo classes in the future. */
function nairobiDate(days, time) {
  const d = new Date(Date.now() + 3 * 3600 * 1000 + days * 86400 * 1000);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}
const nowIso = () => new Date().toISOString();

async function main() {
  await init();
  await ensureAdmin();

  const { n } = await db.get('SELECT COUNT(*) AS n FROM modules');
  if (n) {
    console.log('Demo data not loaded: this database already has modules.');
    console.log('To start over locally: stop the server, delete the "data" folder, then run `npm run seed` again.');
    return;
  }

  const logins = [];
  const password = (envKey) => process.env[envKey] || `Demo-${randomChars(8)}`;

  await setSettings({
    mpesa_method: 'till',
    mpesa_number: '123456',
    mpesa_account_name: 'TRAVIA CAFE (DEMO)',
    contact_phone: '0700 000 000',
    contact_email: 'hello@travia.test',
  });

  const mod = async (title, description, sort, prices = {}) =>
    (
      await db.get(
        'INSERT INTO modules (title, description, sort, price_self, price_live, price_physical) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
        title,
        description,
        sort,
        prices.self ?? 1000,
        prices.live ?? 1000,
        prices.physical ?? 2500
      )
    ).id;
  const foundations = await mod('Cybersecurity Foundations', 'Threats, the CIA triad and safe habits online', 1);
  const network = await mod('Network Security & Nmap', 'Ports, scanning and firewalls', 2);
  const hacking = await mod('Ethical Hacking Lab', 'Hands-on web app testing in a safe lab', 3, { self: 1500, physical: 3000 });

  const video = async (moduleId, title, sample, sort) => {
    const filename = `${crypto.randomUUID()}.mp4`;
    const src = path.join(__dirname, '..', 'demo', 'videos', sample);
    fs.copyFileSync(src, path.join(VIDEO_DIR, filename));
    await db.run(
      'INSERT INTO videos (module_id, title, filename, mime, size, sort) VALUES (?, ?, ?, ?, ?, ?)',
      moduleId,
      title,
      filename,
      'video/mp4',
      fs.statSync(src).size,
      sort
    );
  };
  await video(foundations, 'Welcome & how the course works', 'lesson-1.mp4', 1);
  await video(foundations, 'The CIA triad', 'lesson-2.mp4', 2);
  await video(network, 'Your first Nmap scan', 'lesson-1.mp4', 1);

  const teacherEmail = (process.env.DEMO_TEACHER_EMAIL || 'teacher@travia.test').toLowerCase();
  const teacherPw = password('DEMO_TEACHER_PASSWORD');
  const teacher = (
    await db.get("INSERT INTO staff (name, email, pass_hash, role) VALUES ('Tina Teacher', ?, ?, 'teacher') RETURNING id", teacherEmail, hashPassword(teacherPw))
  ).id;
  logins.push(['Teacher', teacherEmail, process.env.DEMO_TEACHER_PASSWORD ? '(DEMO_TEACHER_PASSWORD in .env)' : teacherPw]);

  const cls = async (moduleId, mode, title, startsAt, duration, extra = {}) =>
    (
      await db.get(
        `INSERT INTO classes (module_id, mode, title, starts_at, duration_min, location, meeting_link, capacity, teacher_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        moduleId,
        mode,
        title,
        startsAt,
        duration,
        extra.location || '',
        extra.link || '',
        extra.capacity || 0,
        teacher
      )
    ).id;
  const nmapLive = await cls(network, 'live', 'Nmap live walkthrough', nairobiDate(7, '18:00'), 90, {
    link: 'https://meet.google.com/abc-defg-hij',
    capacity: 15,
  });
  const foundationsLive = await cls(foundations, 'live', 'Cybersecurity Foundations', nairobiDate(9, '19:00'), 60);
  const lab = await cls(hacking, 'physical', 'Saturday hacking lab', nairobiDate(11, '10:00'), 180, {
    location: 'Westlands, Nairobi (demo venue)',
    capacity: 12,
  });

  const student = async (name, mail, phone, pw) =>
    (await db.get('INSERT INTO students (name, email, phone, pass_hash) VALUES (?, ?, ?, ?) RETURNING id', name, mail, phone, hashPassword(pw))).id;
  const studentEmail = (process.env.DEMO_STUDENT_EMAIL || 'amina@student.test').toLowerCase();
  const studentPw = password('DEMO_STUDENT_PASSWORD');
  const amina = await student('Amina Wanjiku', studentEmail, '254712345678', studentPw);
  logins.push(['Student', studentEmail, process.env.DEMO_STUDENT_PASSWORD ? '(DEMO_STUDENT_PASSWORD in .env)' : studentPw]);
  const brian = await student('Brian Otieno', 'brian@student.test', '254722000111', `x-${randomChars(12)}`);
  const cynthia = await student('Cynthia Muthoni', 'cynthia@student.test', '254733222111', `x-${randomChars(12)}`);
  const david = await student('David Kiprop', 'david@student.test', '254711999888', `x-${randomChars(12)}`);

  const people = {
    [amina]: ['Amina Wanjiku', studentEmail, '254712345678'],
    [brian]: ['Brian Otieno', 'brian@student.test', '254722000111'],
    [cynthia]: ['Cynthia Muthoni', 'cynthia@student.test', '254733222111'],
    [david]: ['David Kiprop', 'david@student.test', '254711999888'],
  };
  const enroll = async (studentId, track, moduleId, classId, amount, status, extra = {}) => {
    const [name, mail, phone] = people[studentId];
    await db.run(
      `INSERT INTO enrollments (ref, name, email, phone, track, module_id, class_id, student_id, amount, status,
                                mpesa_code, paid_at, code_hash, code_used_at, confirmed_at, link_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `TC${randomChars(6)}`,
      name,
      mail,
      phone,
      track,
      moduleId,
      classId,
      studentId,
      amount,
      status,
      extra.mpesa || null,
      extra.mpesa ? nowIso() : null,
      extra.codeHash || null,
      extra.used ? nowIso() : null,
      status === 'confirmed' ? nowIso() : null,
      extra.linkSent ? nowIso() : null
    );
  };

  // Amina: videos unlocked, a paid live class, and one module still to pay for.
  await enroll(amina, 'self', foundations, null, 1000, 'confirmed', { mpesa: 'SJK4H7Q2LM', codeHash: newAccessCode().hash, used: true });
  await enroll(amina, 'live', network, nmapLive, 1000, 'confirmed', { mpesa: 'QWE1234567', codeHash: newAccessCode().hash, linkSent: true });
  await enroll(amina, 'self', network, null, 1000, 'awaiting_payment');
  // Brian: paid and waiting for an admin to confirm.
  await enroll(brian, 'self', foundations, null, 1000, 'pending_review', { mpesa: 'RTY7654321' });
  // Cynthia: confirmed for the physical lab. Her ticket code is printed so check-in can be tried.
  const ticket = newAccessCode();
  await enroll(cynthia, 'physical', hacking, lab, 3000, 'confirmed', { mpesa: 'PLM9876543', codeHash: ticket.hash });
  // David: registered but has not paid.
  await enroll(david, 'live', foundations, foundationsLive, 1000, 'awaiting_payment');

  const staffPath = '/' + String(process.env.STAFF_PATH || 'staff').replace(/^\/+|\/+$/g, '');
  const port = process.env.PORT || 3000;
  console.log('\nDemo data loaded.\n');
  console.log(`Staff dashboard:  http://localhost:${port}${staffPath}`);
  console.log(`Student login:    http://localhost:${port}/login\n`);
  console.log(`  Admin     ${(process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase()}   (ADMIN_PASSWORD in .env)`);
  for (const [role, mail, pw] of logins) console.log(`  ${role.padEnd(9)} ${mail}   ${pw}`);
  console.log(`\nTry teacher check-in with Cynthia's class ticket: ${ticket.display}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
