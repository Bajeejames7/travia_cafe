# Travia Cafe

An online storefront for a cybersecurity school. Students choose how they want to learn, pay with M-PESA, and receive a
one-time code by email. Videos, payments and settings sit behind a staff login at a secret address.

## The three ways to learn

| Track | Who it's for | Default price | What the one-time code does |
|---|---|---|---|
| **Self-paced** | Students who prefer prerecorded videos | KSh 1,000 per module | Unlocks that module's videos on **one** device at `/learn` |
| **Live online** | Students who want a teacher but are far away or busy | KSh 1,000 per session | Class ticket; the meeting link is emailed after payment |
| **In person** | Students who prefer physical classes | KSh 2,500 per session | Class ticket the teacher checks in at the door |

All prices are editable in **Modules & prices**. There are defaults for new modules, and each module has its own three prices.
A registration keeps the price it was quoted, even if you change prices later.

## How a registration flows

1. The student picks a track, a module and (for live or in-person) a class date, then fills in name, email and M-PESA number.
2. The site shows a reference (e.g. `TC7KQ2MA`) and step-by-step M-PESA instructions for your Till, Paybill or phone number.
3. The student pays and pastes the M-PESA transaction code. Each M-PESA code can only be used once.
4. You get an email (if `notify_email` is set). In **Payments**, check the code against the SMS on the business phone, then
   click **Confirm**.
5. The student is emailed their one-time code:
   - **Self-paced:** they enter it at `/learn`. It works once, so a shared code is useless to anyone else. If they change
     phones, click **New code**: the old code and the old device both stop working.
   - **Live:** the email includes the meeting link if the class already has one. Otherwise the teacher clicks **Send link to new
     students** on the class.
   - **In person:** the teacher types the code into **Check-in** when the student arrives. Each code checks in once.

## Staff roles

- **Admin**: everything, including payments, prices, videos, settings, staff accounts and the email log.
- **Teacher**: schedules classes, adds meeting links, emails links and messages to paid students, and checks students in.
  Teachers cannot see payments, prices or videos.

## Running it locally

Requires Node.js 22.13 or newer. It uses Node's built-in SQLite, so there is no database server to install.

```bash
npm install
cp .env.example .env   # then edit it
npm start
```

The console prints the store address and the staff dashboard address. If `ADMIN_PASSWORD` is not set, a random password is
printed once on first start.

## Email

Set the `SMTP_*` variables (Gmail with an App Password, Zoho, Brevo, etc.). Until SMTP is configured, nothing is lost: every
email, including codes, is saved in the **Emails** tab, and the code is shown on screen when you confirm a payment, so you can
send it by SMS or WhatsApp.

## Deploying

This app needs a server with a **persistent disk**, because the database and videos live in `DATA_DIR`. GitHub Pages and
Netlify will not work. Options:

- **A small VPS** (e.g. a KSh ~700/month droplet) with Nginx in front, `TRUST_PROXY=1`, and a process manager like `pm2`.
- **Render / Railway** with a persistent disk mounted at `DATA_DIR`.

Always serve it over HTTPS in production (`NODE_ENV=production` marks cookies `Secure`).

Back up `DATA_DIR/travia.db` regularly. That file contains all registrations and payments.

## Security notes

- Staff passwords are hashed with scrypt. Login and code entry are rate-limited per IP.
- One-time codes are stored only as hashes, so a leaked database cannot be used to unlock videos. The Emails tab does keep a
  copy of what was sent.
- Videos are streamed only to devices holding a valid access cookie and are never in a public folder. Nothing on the web can
  stop someone from screen-recording a video, but there is no download link, and shared codes do not work.
- Meeting links are never shown on the public site. They only go out by email to confirmed students.
