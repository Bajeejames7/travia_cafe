# Travia Cafe

An online storefront for a cybersecurity school. Students choose how they want to learn, pay with M-PESA, and receive a
one-time code by email. Videos, payments and settings sit behind a staff login at a secret address.

## Try the demo on your computer

### 1. Install

You need **Node.js 22.13 or newer** (check with `node -v`; download from [nodejs.org](https://nodejs.org)) and Git.

```bash
git clone https://github.com/Bajeejames7/travia_cafe.git
cd travia_cafe
npm install
```

### 2. Add the `.env` file

Put the `.env` file you were sent into the `travia_cafe` folder. It holds the demo logins and settings.
No file? Copy `.env.example` to `.env` and set at least `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

No database setup is needed: without `DATABASE_URL` the app keeps its data in a local file in the `data` folder.

### 3. Load the demo data and start

```bash
npm run seed     # once: modules, sample videos, classes, a teacher and students
npm start
```

`npm run seed` ends by printing the logins and links. Leave `npm start` running and open the links in your browser.

### 4. Log in

| Who | Where | Email | Password |
|---|---|---|---|
| Admin | `http://localhost:3000/<STAFF_PATH>` | `ADMIN_EMAIL` in `.env` | `ADMIN_PASSWORD` in `.env` |
| Teacher | same staff page | `teacher@travia.test` | `DEMO_TEACHER_PASSWORD` in `.env` |
| Student | `http://localhost:3000/login` | `amina@student.test` | `DEMO_STUDENT_PASSWORD` in `.env` |

`<STAFF_PATH>` is the `STAFF_PATH` value in `.env`; the seed prints the full link. If a demo password is not set
in `.env`, the seed makes one up and prints it. Use separate browser windows (or log out) to switch between people.

### 5. Things to try

**As a new visitor**
1. Open `http://localhost:3000`, pick *Live online*, a module and a class date, and click **Create account to enrol**.
2. Sign up with any made-up email. You come back to the form with your choices kept; click **Continue to payment**.
3. On your dashboard's **Payments** tab, enter any 10-character M-PESA code (e.g. `ABC1234567`).

**As the admin**
1. **Payments → To review**: confirm *Brian* (or your new student). The one-time code appears on screen, because
   email is not set up in the demo. Every email the system would send is listed under **Emails**.
2. **Modules & prices**: change a price, then refresh the home page to see it.
3. **Videos**: upload a short video to a module. **Students**: see accounts and sign a student out.

**As the teacher**
1. **Classes**: schedule a class, open **Students** on a class, use **Send link** for live classes.
2. **Check-in**: enter Cynthia's class ticket, which `npm run seed` printed. Entering it a second time is refused.

**As the student (Amina)**
1. **My courses**: watch the unlocked videos.
2. **Classes**: the paid live class has a **Join class** button.
3. **Payments**: one module is still waiting for payment.
4. To unlock another course, have the admin confirm a self-paced payment and enter the code under **Unlock a course**.

Demo students: **Amina** (logs in; videos unlocked, a paid live class, one unpaid module), **Brian** (paid, waiting
for confirmation), **Cynthia** (confirmed for the in-person lab), **David** (registered, not paid).

### Start over or fix problems

- **Reset the demo:** stop the server (Ctrl+C), delete the `data` folder, run `npm run seed` and `npm start` again.
- **Logins don't work:** the `.env` may be older than the demo data. Get the latest `.env`, then reset the demo.
- **"Port 3000 is in use":** another app is running there. Close it or set `PORT=3001` in `.env`.
- **`node:sqlite` error:** your Node.js is too old; install version 22.13 or newer.
- **Browser tab shows another site's icon:** clear the browser's cached images (Ctrl+Shift+Delete).

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
