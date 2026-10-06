# Travia Cafe

An online storefront for a cybersecurity school. Students choose how they want to learn, pay with M-PESA, and receive a
one-time code by email. Videos, payments and settings sit behind a staff login at a secret address.

## The three ways to learn

| Track | Who it's for | Default price | What the one-time code does |
|---|---|---|---|
| **Self-paced** | Students who prefer prerecorded videos | KSh 1,000 per module | Unlocks that module's videos in the student's account |
| **Live online** | Students who want a teacher but are far away or busy | KSh 1,000 per session | Class ticket; the meeting link is emailed after payment |
| **In person** | Students who prefer physical classes | KSh 2,500 per session | Class ticket the teacher checks in at the door |

All prices are editable in **Modules & prices**. There are defaults for new modules, and each module has its own three prices.
A registration keeps the price it was quoted, even if you change prices later.

## Student accounts and dashboard

Students create an account (email + password, or **Continue with Google**) before enrolling. Their dashboard at `/account` has:

- **My courses**: unlocked video modules with a player, and a box to enter unlock codes.
- **Classes**: booked live and in-person classes, with a **Join class** button once paid and the teacher has added a link.
- **Payments**: every registration, its status, M-PESA instructions and a box to submit the M-PESA code.
- **Profile**: name, phone, password (Google users can add one).

An account can be signed in on at most `MAX_STUDENT_DEVICES` devices at once (default 2). Signing in on another
device signs out the oldest, which makes sharing one account with friends impractical. Forgotten passwords are reset
by an emailed link that expires after one hour.

To turn on Google sign-in, create an OAuth client in Google Cloud Console (Web application, redirect URI
`<PUBLIC_URL>/auth/google/callback`) and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. If someone signs in with
Google using the email of an existing unverified password account, the accounts are merged and the old password is
removed, so nobody can claim another person's email in advance.

## How a registration flows

1. The logged-in student picks a track, a module and (for live or in-person) a class date.
2. The dashboard shows a reference (e.g. `TC7KQ2MA`) and step-by-step M-PESA instructions for your Till, Paybill or phone number.
3. The student pays and pastes the M-PESA transaction code. Each M-PESA code can only be used once.
4. You get an email (if `notify_email` is set). In **Payments**, check the code against the SMS on the business phone, then
   click **Confirm**.
5. The student is emailed their one-time code:
   - **Self-paced:** they enter it on their dashboard. It works once and ties the module to their account, so a shared
     code is useless to anyone else.
   - **Live:** the email includes the meeting link if the class already has one. Otherwise the teacher clicks **Send link to new
     students** on the class.
   - **In person:** the teacher types the code into **Check-in** when the student arrives. Each code checks in once.

## Staff roles

- **Admin**: everything, including payments, prices, videos, settings, staff accounts, student accounts (disable, sign out
  devices) and the email log.
- **Teacher**: schedules classes, adds meeting links, emails links and messages to paid students, and checks students in.
  Teachers cannot see payments, prices or videos.

## Running a local preview

Requires **Node.js 22.13 or newer** (`node -v`). Without `DATABASE_URL` the app uses a local SQLite file, so there
is no database to install.

```bash
git clone https://github.com/Bajeejames7/travia_cafe.git
cd travia_cafe
npm install
# put the .env file you were given in this folder (or copy .env.example to .env and fill it in)
npm run seed     # loads demo modules, videos, classes, a teacher and students
npm start
```

`npm run seed` prints the logins and the staff dashboard address. It only runs on an empty database; to start over,
stop the server and delete the `data` folder.

The demo contains students in every state, so you can try each flow:

- **Amina** (the demo student login): videos unlocked, a paid live class with a Join button, one module still to pay for.
- **Brian**: paid and waiting for an admin to confirm (Payments → To review).
- **Cynthia**: confirmed for the in-person lab; the seed prints her ticket code to try teacher Check-in.
- **David**: registered but not paid.

## Email

Set the `SMTP_*` variables (Gmail with an App Password, Zoho, Brevo, etc.). Until SMTP is configured, nothing is lost: every
email, including codes, is saved in the **Emails** tab, and the code is shown on screen when you confirm a payment, so you can
send it by SMS or WhatsApp.

## Deploying (Render + Aiven PostgreSQL)

1. **Aiven:** create a PostgreSQL service. From its overview page copy the **Service URI** and download the
   **CA certificate** (`ca.pem`).
2. **Render:** New → Blueprint → choose this repo. `render.yaml` sets up the web service, a persistent disk for videos
   and the environment variables. When asked, fill in:
   - `DATABASE_URL`: the Aiven Service URI.
   - `DATABASE_CA_CERT`: the full contents of `ca.pem`.
   - `PUBLIC_URL`: your site address, e.g. `https://travia-cafe.onrender.com`.
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`: the first admin login (use a new, strong password, not the demo one).
   - SMTP and Google settings when you have them.
3. Deploy. Tables are created automatically on first start. Open `<PUBLIC_URL>/<STAFF_PATH>` to log in; Render
   generates a random `STAFF_PATH`, which you can read under the service's Environment tab.
4. If you use Google sign-in, add `<PUBLIC_URL>/auth/google/callback` to the OAuth client's redirect URIs.

**Videos need the persistent disk.** Render's normal filesystem is wiped on every deploy and restart, so uploaded videos
are stored on the disk mounted at `DATA_DIR`. A disk requires a paid instance (Starter or above); the free plan
would lose every uploaded video. Everything else (accounts, payments, classes) lives in Aiven.

Do not run `npm run seed` against production; it refuses when `NODE_ENV=production`.

## Security notes

- Staff passwords are hashed with scrypt. Login and code entry are rate-limited per IP.
- One-time codes are stored only as hashes, so a leaked database cannot be used to unlock videos. The Emails tab does keep a
  copy of what was sent.
- Videos are streamed only to signed-in students who have unlocked that module and are never in a public folder. Nothing on the web can
  stop someone from screen-recording a video, but there is no download link, and shared codes do not work.
- Meeting links are never shown on the public site. They only go out by email to confirmed students.
