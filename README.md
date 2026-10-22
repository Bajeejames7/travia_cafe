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
1. **Payments → To review**: confirm *Brian* (or your new student). His self-paced videos unlock in his account at once.
   For a class booking the one-time code appears on screen, because email is not set up in the demo. Every email the
   system would send is listed under **Emails**.
2. **Modules & prices**: change a price, then refresh the home page to see it.
3. **Videos**: upload a short video to a module. **Students**: see accounts and sign a student out.

**As the teacher**
1. **Classes**: schedule a class, open **Students** on a class, use **Send link** for live classes.
2. **Check-in**: enter Cynthia's class ticket, which `npm run seed` printed. Entering it a second time is refused.

**As the student (Amina)**
1. **My courses**: watch the unlocked videos.
2. **Classes**: the paid live class has a **Join class** button.
3. **Payments**: one module is still waiting for payment.
4. **Payments**: pay for the waiting module. With PayHero switched on there is a **Pay with M-PESA** button; without
   it, enter any 10-character code and have the admin confirm it. Either way the videos appear under **My courses**.

Demo students: **Amina** (logs in; videos unlocked, a paid live class, one unpaid module), **Brian** (paid, waiting
for confirmation), **Cynthia** (confirmed for the in-person lab), **David** (registered, not paid).

### Start over or fix problems

- **Reset the demo:** stop the server (Ctrl+C), delete the `data` folder, run `npm run seed` and `npm start` again.
- **Logins don't work:** the `.env` may be older than the demo data. Get the latest `.env`, then reset the demo.
- **"Port 3000 is in use":** another app is running there. Close it or set `PORT=3001` in `.env`.
- **`node:sqlite` error:** your Node.js is too old; install version 22.13 or newer.
- **Browser tab shows another site's icon:** clear the browser's cached images (Ctrl+Shift+Delete).

## The three ways to learn

| Track | Who it's for | Default price | What happens after payment |
|---|---|---|---|
| **Self-paced** | Students who prefer prerecorded videos | KSh 1,000 per module | The videos unlock in the student's account straight away |
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
3. **With PayHero on:** the student taps **Pay with M-PESA**, approves the prompt on their phone, and the payment is
   confirmed automatically within seconds (skip to step 5).
   **Otherwise:** the student pays from the M-PESA menu and pastes the transaction code. Each M-PESA code can only be used once.
4. For typed codes, you get an email (if `notify_email` is set). In **Payments**, check the code against the SMS on the
   business phone, then click **Confirm**.
5. The student is emailed a confirmation:
   - **Self-paced:** the videos are already unlocked in their account, so there is nothing to type. (Codes from before
     student accounts still work under **Have an unlock code?**: once, and only for the account that redeems them.)
   - **Live:** the email includes the meeting link if the class already has one. Otherwise the teacher clicks **Send link to new
     students** on the class.
   - **In person:** the teacher types the code into **Check-in** when the student arrives. Each code checks in once.

## Staff roles

- **Admin**: everything, including payments, prices, videos, settings, staff accounts, student accounts (disable, sign out
  devices) and the email log.
- **Teacher**: schedules classes, adds meeting links, emails links and messages to paid students, and checks students in.
  Teachers cannot see payments, prices or videos.

## Email

Set `BREVO_API_KEY` (Brevo's free plan, which also works on Render's free plan) or the `SMTP_*` variables (Gmail with an
App Password, Zoho, etc., on hosts that allow SMTP). Until email is configured, nothing is lost: every email, including
codes, is saved in the **Emails** tab, and the code is shown on screen when you confirm a payment, so you can send it by
SMS or WhatsApp.

## Going live, for free

Every piece runs on a free plan and none needs a card:

| Piece | Service | Free allowance |
|---|---|---|
| Website | Render free web service | Sleeps after 15 minutes without visitors; the next visit takes about a minute to wake it |
| Database | Aiven free PostgreSQL | 1 GB (plenty: videos are not stored here) |
| Videos | Backblaze B2 | 10 GB stored; watching is free up to 3× what is stored, per month |
| Email | Brevo | 300 emails a day |
| M-PESA prompt | PayHero | No monthly fee; a small fee per successful payment ([pricing](https://app.payhero.co.ke/pricing)) |
| Domain | Cloudflare DNS (already set up) | Free |

Sign up for each with the school's Gmail and a different strong password for each one. If any of them asks for a card,
stop: something is set to a paid plan.

### 1. Database: Aiven PostgreSQL

1. Sign up at [aiven.io](https://aiven.io) and create a project.
2. **Create service → PostgreSQL → Free plan**, in **Frankfurt** if offered. Wait until it shows *Running*.
3. On the service's **Overview** page, copy the **Service URI** and download the **CA certificate** (`ca.pem`).
   Keep both private: the URI contains the database password.

### 2. Videos: Backblaze B2

1. Sign up at [backblaze.com/sign-up/cloud-storage](https://www.backblaze.com/sign-up/cloud-storage) and choose the
   **EU Central** region when asked (closest to Kenya).
2. **Buckets → Create a Bucket:** any unique name (e.g. `traviacafe-videos`), **Files in Bucket: Private**.
   Note the bucket's **Endpoint**, e.g. `s3.eu-central-003.backblazeb2.com`.
3. **Application Keys → Add a New Application Key:** allow access to that bucket only, **Read and Write**.
   Copy the **keyID** and **applicationKey** (it is shown only once).
4. **Caps & Alerts:** set every daily cap to **$0**, so you can never be charged.

Students never get a permanent video link: the site checks they have paid, then hands the player a link that expires
after a few hours.

### 3. Email: Brevo

1. Sign up at [brevo.com](https://www.brevo.com) (free plan).
2. **Senders, domains & dedicated IPs → Domains → Add a domain:** `traviacafe.com`, and add the DNS records Brevo shows
   in Cloudflare (Brevo can do it for you with its Cloudflare option). Then add a sender such as `hello@traviacafe.com`.
   Sending from the school's own domain is what keeps the emails out of spam folders.
3. **SMTP & API → API keys → Generate a new API key**, and copy it.

### 4. Website: Render

1. Sign up at [render.com](https://render.com) and connect the GitHub account that owns this repository.
2. **New → Blueprint →** choose this repository (`main`). `render.yaml` creates one **free** web service in Frankfurt.
3. Fill in what Render asks for; leave anything you do not have yet blank and add it later under **Environment**:

   | Setting | Value |
   |---|---|
   | `DATABASE_URL` | the Aiven Service URI |
   | `DATABASE_CA_CERT` | the full text of `ca.pem` (open it in Notepad and copy everything) |
   | `PUBLIC_URL` | `https://travia-cafe.onrender.com` for now; change to `https://traviacafe.com` in step 6 |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the first admin login. Leave blank if the admin already exists in the database |
   | `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY_ID`, `S3_SECRET` | from Backblaze, step 2 |
   | `BREVO_API_KEY` | from Brevo, step 3 |
   | `MAIL_FROM` | `Travia Cafe <hello@traviacafe.com>` (the sender you verified in Brevo) |
   | `MAIL_REPLY_TO` | `traviacafe@gmail.com`, so replies reach the school's inbox |
   | `PAYHERO_*` | see step 5 (can be added later) |

4. **Apply.** Tables are created on first start. Open `<PUBLIC_URL>/<STAFF_PATH>` to log in; Render generated a random
   `STAFF_PATH`, which you can read under the service's **Environment** tab. Fill in **Settings** (M-PESA till or
   paybill, contact phone and email), then add your modules and videos.

Optional: the free site sleeps when nobody visits for 15 minutes. A free monitor such as
[UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org) opening `<PUBLIC_URL>/api/health` every
10 minutes keeps it awake. Render gives 750 free hours a month, enough for one always-on site.

Do not run `npm run seed` against production; it refuses when `NODE_ENV=production`.

### 5. M-PESA prompt: PayHero

1. Sign up at [app.payhero.co.ke](https://app.payhero.co.ke) and complete their verification.
2. **Payment Channels:** link the school's Till or Paybill. Note the **channel ID** under *My Payment Channels*.
3. **API Keys → Add new API Key:** copy the **Basic Authorization** token.
4. In Render, set `PAYHERO_AUTH` to the token and `PAYHERO_CHANNEL_ID` to the channel ID, then save (Render redeploys).

Students then see **Pay with M-PESA** on their dashboard, approve the prompt on their phone, and are confirmed within
seconds: videos unlock at once and class tickets are emailed, with nobody checking SMS messages. PayHero calls the site at
`<PUBLIC_URL>/payhero/callback`; the site double-checks every payment with PayHero before trusting it, and re-checks on
its own every minute in case a callback is lost. Paying from the M-PESA menu and typing the code keeps working as a backup.

### 6. Point traviacafe.com at the site

`traviacafe.com` is on Cloudflare, currently showing the coming-soon page.

1. In Render: the web service → **Settings → Custom Domains → Add** `traviacafe.com`, then `www.traviacafe.com`.
2. In Cloudflare: if the coming-soon page is a Cloudflare Pages project, remove `traviacafe.com` from that project's
   **Custom domains** first. Then in **DNS**, create (or edit) two records:
   - `CNAME` `@` → `travia-cafe.onrender.com`
   - `CNAME` `www` → `travia-cafe.onrender.com`

   Set both to **DNS only** (grey cloud). Behind Cloudflare's proxy the site would see Cloudflare's address instead
   of each visitor's, and the login limits would lock everyone out together.
3. Back in Render, click **Verify** on each domain and wait for the certificate.
4. Change `PUBLIC_URL` to `https://traviacafe.com`. If you use Google sign-in, add
   `https://traviacafe.com/auth/google/callback` to the OAuth client's redirect URIs.

If you later move to a paid Render instance, you can attach a disk and leave `S3_BUCKET` empty to keep videos on the
server, and use any SMTP server (such as Gmail with an App Password) instead of Brevo.

## Security notes

- Staff passwords are hashed with scrypt. Login and code entry are rate-limited per IP.
- One-time codes are stored only as hashes, so a leaked database cannot be used to unlock videos. The Emails tab does keep a
  copy of what was sent.
- Videos are only played to signed-in students who have unlocked that module, from a private bucket (or folder) through
  links that expire after a few hours. Nothing on the web can stop someone from screen-recording a video, but there is no
  download link, and shared codes do not work.
- Meeting links are never shown on the public site. They only go out by email to confirmed students.
