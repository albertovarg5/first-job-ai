# First Job AI

**First Job AI helps people land their first job.** It's built for college students, recent graduates, internship seekers, career changers, and anyone with little work experience.

It searches real job listings, turns everyday experience (class projects, volunteering, part-time jobs) into professional resume language, builds a clean PDF resume and cover letters, tracks applications, runs interview practice, and keeps the search moving with small daily missions.

- **Guest mode** works with no account: data is saved in your browser.
- **Accounts** (optional) save your data on the server so you can sign in from any device.
- **AI is optional.** Every feature works without it in a clearly labeled **Basic mode**. Connect an Anthropic API key to turn on AI.
- **Real job search** uses the JSearch API by OpenWeb Ninja (directly, or through RapidAPI). Without a key, the app explains how to set it up — it never shows made-up jobs.

---

## Features

| Area | What you can do |
| --- | --- |
| **Job Search** | Search real listings by title/keywords and location. Filter by job type (full-time, part-time, internship, contract), remote, date posted, experience and country. See employer, location, type, salary (when listed), posting date and a link to the original posting. Load more results, save jobs, add them to your tracker. |
| **Job Tracker** | The center of the app. Add, edit and delete applications. Statuses: Interested, Applying, Applied, Interview, Offer, Rejected. Dates, notes, interview times, status history. Duplicate entries are blocked. List and Board views. Every row shows its next step. |
| **Application workspace** | Open any tracked job to work through it step by step: add the description → **analyze the requirements** (AI, or keywords in Basic mode) → tailor your resume → write a cover letter → apply → practice the interview. Each step links to the right tool with the job already filled in, and progress is worked out from what you actually did. |
| **Resume Builder** | Guided sections, "Improve wording", **Draft summary from my resume**, completeness score, live preview, **PDF download**, and **Tailor to a job**. |
| **Cover Letters** | Pick a saved/tracked job or paste a posting. Drafts use only your resume and your own notes; requirements you don't show are listed as gaps instead of being claimed. Edit, save, copy, download PDF. |
| **Interview Practice** | Questions from a built-in library, from skills named in a job description, or (with AI) generated for the job. Written answers, feedback (AI or automated checklist), history. |
| **Career Assistant** | Preferences (role, location, interests, job types). Recommended jobs ranked against your resume, with **"Why it may fit"** (checkable facts) kept separate from **"Check before applying"**. Transferable skills with the exact resume line as evidence, and practical ways to strengthen your qualifications. |
| **Experience Translator** | Describe what you did in plain words → editable resume bullets. |
| **Career Missions** | Three small tasks per day, streaks and history. |
| **Dashboard** | **Your next steps** for open applications, progress, pipeline by status, saved jobs, upcoming interviews, missions, recent activity — all from your real data. |
| **Accounts** | Sign up, sign in, sign out, password reset, change password, delete account. Copy guest data into a new account. |
| **Settings** | Profile, account, plan and AI usage this month, AI connection, backup/restore, delete all data. |
| **Plans** | **Free**: 20 AI requests a month. **Premium** (Stripe subscription, monthly and optionally yearly): 200 AI requests a month. Both limits are configurable. The **Plans & Pricing** page (sidebar) compares the plans and starts Stripe Checkout; Settings and the Dashboard link to it. Card changes and cancellation happen on Stripe-hosted pages. Premium can only be bought when Stripe is configured; see [Premium subscriptions (Stripe)](#premium-subscriptions-stripe). |

### Honesty rules built into the app

- The tools **only use what you write**. They never invent numbers, results, tools, employers, duties or qualifications.
- Missing details become **[bracketed prompts]** for you to fill in.
- AI skill analysis is only shown when the AI can **quote your resume** as evidence; anything else is hidden.
- Job listings come from JSearch and are labeled as possibly closed — always check the original posting.
- Results are labeled **AI** or **Basic mode — no AI**.

---

## Run it on Windows (PowerShell)

You need **Node.js 22.13 or newer** (22 LTS or 24 recommended) — download the LTS installer from <https://nodejs.org>. Check with:

```powershell
node -v
```

Then, in the project folder (the one with `package.json`):

```powershell
npm install
Copy-Item .env.example .env   # first time only; then edit .env (see below)
npm run dev
```

The app opens at **<http://localhost:5173>**. Stop it with **Ctrl + C**.

> If PowerShell says *"running scripts is disabled on this system"*, run this once and try again:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### Commands

| Command | What it does |
| --- | --- |
| `npm install` | Downloads the libraries. Run once, or after `package.json` changes. |
| `npm run dev` | Development server with all `/api` routes (accounts, data, AI, jobs). |
| `npm test` | Runs the automated tests (Node's built-in test runner). |
| `npm run build` | Builds the site into `dist/`. |
| `npm start` | Production server: serves `dist/` and the API (`http://localhost:3000`). Run `npm run build` first. |
| `npm run preview` | Vite's preview of `dist/` with the API, for a quick check. |

---

## Configuration (`.env`)

All settings are server-side. **Never** prefix them with `VITE_` (that would send them to the browser — the server refuses to start and `npm run build` fails if a key is named `VITE_…`). `.env` is in `.gitignore`.

Every API is **optional**: the app starts without any keys and each feature explains what's missing. At startup the server prints which integrations are on, and a warning for anything missing or malformed, for example:

```
[First Job AI] AI: on · Job search: on (OpenWeb Ninja) · Reset email: off
[config] Password-reset email needs both RESEND_API_KEY and EMAIL_FROM; only RESEND_API_KEY is set, so email is off.
```

| Variable | Needed for | Notes |
| --- | --- | --- |
| `JSEARCH_API_KEY` | Job search | Your OpenWeb Ninja API key for JSearch (a RapidAPI JSearch key also works). |
| `JSEARCH_PROVIDER` | Optional | `openwebninja` or `rapidapi`. Blank = detected from the key (RapidAPI keys contain `msh…jsn`). |
| `JSEARCH_MONTHLY_LIMIT` | Optional | App stops searching after this many requests per month. Set it to your plan's allowance. |
| `JSEARCH_COUNTRY` | Optional | Default search country (`us`, `ca`, `gb`, …). |
| `ANTHROPIC_API_KEY` | AI features | From <https://console.anthropic.com> (starts with `sk-ant-`). |
| `AI_MODEL` | Optional | Defaults to `claude-sonnet-5-5`. Set `claude-opus-5-5` for the most capable model (higher cost per request). |
| `AI_FREE_MONTHLY_LIMIT` | Optional | AI requests per signed-in user per month on the Free plan (default 20). Failed requests don't count. |
| `AI_PREMIUM_MONTHLY_LIMIT` | Optional | Same for the Premium plan (default 200). |
| `DATABASE_PATH` | Accounts | SQLite file. Default `data/first-job-ai.db`. Use a persistent disk in production. |
| `APP_URL` | Password reset (production) | Public URL of the site, e.g. `https://firstjob.example.com`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Password reset emails | From <https://resend.com>, with a verified sender domain. |
| `PORT` | Optional | Production port (default 3000). |
| `TRUST_PROXY` | Optional | `true` behind a proxy that sets `X-Forwarded-For` (for correct rate limiting). |
| `COOKIE_SECURE` | Optional | Defaults to `true` in production. Only set `false` to test the production build over plain `http://`. |
| `API_REQUIRE_AUTH` | Optional | Defaults to `true` in production: only signed-in users can use AI/job search (protects your paid keys). |
| `STRIPE_SECRET_KEY` | Premium | Stripe secret key (`sk_test_…` while testing, `sk_live_…` when live). Server only. |
| `STRIPE_WEBHOOK_SECRET` | Premium | Signing secret of the webhook endpoint (`whsec_…`). |
| `STRIPE_PRICE_MONTHLY` | Premium | Price ID (`price_…`) of the monthly Premium price. |
| `STRIPE_PRICE_YEARLY` | Optional | Price ID of a yearly Premium price. Blank = monthly only. |
| `STRIPE_EXTRA_PREMIUM_PRICES` | Optional | Comma-separated older Premium price IDs that should still count as Premium after you change prices. |

### Connect real job search (JSearch by OpenWeb Ninja)

1. Create an account at <https://app.openwebninja.com> and subscribe to the **JSearch** API (the free plan works; note its monthly request allowance).
2. Copy your **API key** from the OpenWeb Ninja dashboard.
3. In `.env`: `JSEARCH_API_KEY=your-key` and, optionally, `JSEARCH_MONTHLY_LIMIT=` your allowance and `JSEARCH_COUNTRY=` your default country.
4. Restart `npm run dev`. The terminal should say `Job search: on (OpenWeb Ninja)`. Open **Job Search**.

**Already have a RapidAPI key?** JSearch is also sold on <https://rapidapi.com> (search "JSearch", subscribe, copy the **X-RapidAPI-Key**). Put it in `JSEARCH_API_KEY`; the app recognizes RapidAPI keys and switches to RapidAPI automatically (or set `JSEARCH_PROVIDER=rapidapi`).

How it works: the browser calls `/api/jobs/search` on this app; the server adds the key and calls `GET https://api.openwebninja.com/jsearch/search-v2` (header `x-api-key`) — or `https://jsearch.p.rapidapi.com/search` for RapidAPI keys. Results are converted into one format (title, employer, location, description, date posted, salary, apply link). To save requests, identical searches are cached for 30 minutes and one page (about 10 jobs) is fetched at a time; "Load more" fetches the next page. Invalid keys, plan limits, the monthly limit, timeouts and outages each show a clear message. Searches with no matches show "No jobs found" — sample jobs are never shown.

### Connect AI (Anthropic)

1. Create an API key at <https://console.anthropic.com> (billing required; each request usually costs a fraction of a cent).
2. In `.env`: `ANTHROPIC_API_KEY=sk-ant-...`
3. Restart. **Settings → AI connection** should say **Connected**.

**What is sent to the AI provider:** only the text needed for the feature you use — for example your resume content (without your name, email or phone), a job description, an interview answer. Nothing is sent when AI is off, and you can turn it off in Settings.

### Accounts, saved jobs and password reset

Accounts work out of the box with a local SQLite file (`data/first-job-ai.db`, ignored by Git). Nothing to install: it uses Node's built-in `node:sqlite`.

When you're signed in, everything you save — profile, resume, **saved jobs**, **tracker entries and their statuses** (Interested → Applying → Applied → Interview → Offer / Rejected), cover letters, practice — is stored in your account in that database and comes back after a refresh, signing out and in, or a server restart. As a guest, the same data is kept in this browser only. **Save** on a job card keeps the listing; **Track** adds it to the Job Tracker as *Interested*, and the card then shows its current tracker status.

**Password-reset email (Resend):**

1. Create an account at <https://resend.com>, add and **verify your domain** (Domains → Add domain, then add the DNS records it shows).
2. Create an API key (API Keys → Create, starts with `re_`).
3. In `.env` (or your host's dashboard): `RESEND_API_KEY=re_...`, `EMAIL_FROM=First Job AI <no-reply@yourdomain.com>` (an address on the verified domain) and, in production, `APP_URL=https://your-site`.

- **Development without Resend:** "Forgot password" prints the reset link in the terminal running `npm run dev`.
- **Production without Resend:** password reset is turned off and the page says so.
- If Resend refuses a message (for example, unverified domain), the user sees "We couldn't send the email" and the server log shows Resend's reason.

### Premium subscriptions (Stripe)

Premium is a recurring Stripe subscription. Payment, card changes and cancellation all happen on **Stripe-hosted pages** (Checkout and the customer portal), so card details never reach this app or its database.

**How it works:**
- The browser only asks for "monthly" or "yearly". The server picks the Price ID from `.env`, finds or creates the Stripe customer for the signed-in user, and refuses if that user already has a subscription.
- A user becomes Premium only after the server has read their subscription from Stripe. That happens in a webhook whose signature checks out, or when the success page asks the server to verify the checkout session with Stripe. Landing on the success page alone grants nothing.
- Premium lasts while the subscription is `active` or `trialing`.
  - During a failed payment (`past_due`), Premium continues for up to 14 days while Stripe retries the card.
  - When the subscription is canceled, unpaid or expired, the account goes back to Free.
  - A **full refund of the latest payment**, or a **dispute (chargeback)**, cancels the subscription immediately in Stripe and the account goes back to Free, so the customer isn't charged again. Partial refunds and refunds of older months change nothing.
  - If a webhook is ever missed, Premium still ends 3 days after the paid period.
- **Live-mode safety lock:** a live key (`sk_live_…`) takes no payments until `STRIPE_ALLOW_LIVE=true` is also set. Test keys need no unlock.
- Deleting an account cancels its subscription first. If Stripe can't be reached, the account is kept so nobody is billed for a deleted account.

**1. Set up Stripe in test mode** (test mode is called a *sandbox* in newer dashboards; nothing is really charged):

1. Create an account at <https://dashboard.stripe.com/register> and make sure you're in test mode / a sandbox. You don't need to activate payments yet.
2. **Product catalog → Add product**:
   - Name: "First Job AI Premium".
   - Add a **recurring, monthly** price (for example $9.99).
   - Optionally add a second **recurring, yearly** price on the same product.
   - Save, then open each price and copy its **Price ID** (`price_…`, not the product's `prod_…`).
3. **Developers → API keys**: copy the **Secret key** (`sk_test_…`). The publishable key is not needed.
4. **Settings → Billing → Customer portal** (test mode): turn on:
   - cancel subscriptions (choose "at end of billing period");
   - update payment methods;
   - optionally switch plans (add your Premium product's prices).

   Add your terms and privacy links, then **Save**.
5. **Settings → Billing → Subscriptions and emails → Manage failed payments**: keep retries on and choose what happens when all retries fail. "Cancel the subscription" is the simplest. The app also stops Premium 14 days after a payment fails.
6. In `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRICE_MONTHLY=price_...
   STRIPE_PRICE_YEARLY=price_...      (or leave blank)
   ```

**2. Receive webhooks locally with the Stripe CLI:**

1. Install the Stripe CLI (<https://docs.stripe.com/stripe-cli>), then in a second VS Code terminal:
   ```powershell
   npm run stripe:listen
   ```
   This uses the test key from `.env`, so events come from the **same Stripe account as the app**, even if `stripe login` was done with a different account. It forwards the events the app needs to `localhost:5173/api/billing/webhook` (the `npm run dev` port; add `-- --port 3000` for `npm start`). It refuses live keys.
2. It tells you whether `STRIPE_WEBHOOK_SECRET` in `.env` matches. If not, copy the printed `whsec_…` into `.env`, save, and restart `npm run dev`.
3. The startup line should say `Premium billing: test mode`, with no `[config]` warnings about Stripe.

Using the plain CLI instead? Newer versions require an event list: `stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,charge.refunded,charge.dispute.created --forward-to localhost:5173/api/billing/webhook`, and the CLI must be logged in to the same account as your key.

**3. Test it** (keep `npm run stripe:listen` running):

| Test | How | Expected |
| --- | --- | --- |
| Successful subscription | Sign in → **Plans & Pricing** (sidebar) → choose Monthly or Yearly → **Subscribe**. Pay with card `4242 4242 4242 4242`, any future date, any CVC, any postal code. | You return to "Welcome to Premium"; Settings shows Premium and 200 AI requests; the listener shows `200` responses. |
| Canceled checkout | Click Upgrade, then the back arrow on the Stripe page. | "Checkout canceled", still Free. |
| Can't buy twice | Click Upgrade again while Premium. | The button is gone; the API answers "You already have a subscription". |
| Cancellation | **Manage subscription** → Cancel. | Settings says Premium stays active until the period end. In the Dashboard, cancel it immediately (Subscriptions → … → Cancel immediately) to see it switch to Free. |
| Failed payment | Subscribe with card `4000 0000 0000 0341` (attaches, but charges fail). Then use a [test clock](https://docs.stripe.com/billing/testing/test-clocks) or the Dashboard to bill again. | Status "Payment failed", warning to update the card; Free after the retries end. |
| Renewal and expiry | Billing → **Test clocks**: create a customer on a clock, subscribe, advance the clock past the period end. | Status stays Active after renewal; ends when the subscription is canceled. |
| Full refund | While Premium: Dashboard → **Payments** → the payment → **Refund** → full amount. | the listener shows `charge.refunded` → `200`; the subscription is canceled; Settings shows Free. |
| Partial refund | Refund only part of a payment. | Still Premium. |
| Dispute | Subscribe with card `4000 0000 0000 0259` (creates a dispute after paying). | The subscription is canceled; Settings shows Free. |

`stripe trigger …` commands create customers that don't belong to any account. The app acknowledges those events and correctly ignores them, so use the real checkout flow to test Premium.

**4. Go live (only when you're ready to charge real people):**

Things only you can do in Stripe (the app can't do them for you):
- **Activate your account**: legal name or business type, address, date of birth, the last digits of a government ID or tax number (e.g. SSN/EIN in the US), and a phone number. Stripe may ask for an ID photo.
- **Add a bank account** for payouts (Settings → Business → Bank accounts and currencies).
- **Public business details**: the name customers see on card statements (statement descriptor), a support email, and the website URL.
- **Tax**: decide whether you must charge sales tax/VAT where your customers live. Stripe Tax can calculate it, but whether you need to register is a question for you (or an accountant). The app doesn't turn on tax collection.
- **Terms of service, privacy policy and refund policy** pages, linked in the customer portal and Checkout settings.

Then:
1. Switch the Dashboard to **live mode**.
2. Recreate the product and prices in live mode (test objects don't exist in live mode) and copy the live Price IDs.
3. Save the customer portal and failed-payment settings again in live mode.
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR-DOMAIN/api/billing/webhook` (must be `https://`).
   - Select these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.
   - Copy the endpoint's signing secret.
   - Your **test-mode** setup needs the two new events too if you use a Dashboard endpoint there. (`npm run stripe:listen` already includes them.)
5. In your host's environment settings (not in Git), set `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_WEBHOOK_SECRET` (live endpoint), the live `STRIPE_PRICE_*`, `APP_URL=https://YOUR-DOMAIN`, and **`STRIPE_ALLOW_LIVE=true`**. Redeploy.
6. The server log should say `Premium billing: LIVE`. If it says `locked`, `STRIPE_ALLOW_LIVE` is missing. Make one real purchase with your own card, check Settings shows Premium and the webhook shows `200` in the Dashboard, then refund it in full from the Dashboard. That refund also tests refund handling: your account should return to Free.

To switch real payments off again at any time, remove `STRIPE_ALLOW_LIVE` (or set it to `false`) and redeploy. Existing subscriptions keep renewing in Stripe, and their webhooks are still processed.

---

## Testing

### Automated tests

```powershell
npm test
```

78 tests cover: job search for both providers (OpenWeb Ninja `search-v2` with cursor paging and RapidAPI; provider detection, validation, success, caching, empty results, duplicate listings, missing fields, invalid/unsubscribed key, rate limit, upstream errors, network failure, timeout, monthly limit), settings validation (`VITE_` secrets, half-configured email, bad limits), Anthropic error handling (bad key, unknown model, rate limit, overloaded, no credit, refusal, cut-off answer), Resend email sending, saved jobs and tracker entries persisting per user in a real SQLite file across sign-out, sign-in and restart, job search sign-in rules, saved-job dedupe, tracker duplicates and status history, accounts (hashing, sessions, sign-in errors, rate limiting, reset tokens, change password, delete account), **per-user data isolation**, CSRF blocking, save conflicts, data validation, migrations, honesty checks for cover letters/summaries/skills, job recommendations, AI route validation, plus the original translator, resume, PDF, missions and interview tests.

The tests never call the real JSearch or Anthropic APIs; those calls are simulated.

### Manual checklist

1. **Guest start:** open the app → **Get started** → finish onboarding.
2. **Job Search:** search "marketing intern" in a city, open **Filters**, try **Remote only** / **Internship**, click **Load more**, **Save** a job, **Track** a job, open **Details** and **View listing**.
3. **Saved tab:** the saved job is there once; remove it (confirmation appears).
4. **Job Tracker:** the tracked job shows as Interested. Add one manually, try adding the same company + title + location again (blocked), change a status, open it to see the history, delete one.
5. **Resume Builder:** add a job with bullets and 5 skills, click **Draft from my resume** in Summary, **Preview → Download PDF**.
6. **Cover Letters:** **New cover letter** → pick the saved job → **Write draft**. Check that skills you don't have appear under "gaps", not in the letter. Edit, **Save**, **Download PDF**.
7. **Interview Practice:** paste a job description, start, answer, **Get feedback**.
8. **Career Assistant:** set interests, **Find … jobs**, read "Why it may fit" and "Check before applying"; review transferable skills.
9. **Accounts:** **Settings → Create a free account** (keep "Copy … into my new account" checked). Your data is still there. Refresh. Sign out → you're back to guest data. Sign in again → account data returns. Try a wrong password. Try **Forgot password** (link appears in the terminal).
10. **Phone layout:** narrow the window (or F12 → device toolbar) and use the menu.

---

## Deployment

The app is a single Node.js server (`server/index.js`) that serves the built site and the API from the **same address**, so the frontend always talks to the right backend with no extra URL setting. It needs a host that runs a long-lived Node process **with a persistent disk** for the SQLite file — for example Render (with a disk), Railway (with a volume), Fly.io (with a volume) or a small VPS. Purely static/serverless hosts (Netlify, Vercel functions, GitHub Pages) are **not** suitable for accounts as-is.

**Step-by-step launch guide (Render, domain, Stripe live mode): [docs/DEPLOY.md](docs/DEPLOY.md).** The repository includes a Render Blueprint ([render.yaml](render.yaml)) and a read-only launch check (`npm run check:production`).

In short, on Render:

1. Push the repository to GitHub (`.env` and `data/` are ignored — check with `git status`).
2. New **Blueprint** → your repo (or a Web Service with build command `npm ci --include=dev && npm run build` — the `--include=dev` matters because `NODE_ENV=production` would skip Vite — and start command `npm start`).
3. A **Disk** mounted at `/var/data` with `DATABASE_PATH=/var/data/first-job-ai.db`. Without it, every deploy erases all accounts and subscriptions.
4. Environment variables in the dashboard (see [docs/DEPLOY.md](docs/DEPLOY.md)).
5. Use **one instance** (rate limits and the job-search cache are kept in memory; SQLite is a single file).

In production the server also writes a consistent database backup at startup and every 24 hours to `backups/` next to the database (keeps 14; `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_DISABLED=true` to change), and `npm run backup` makes one on demand.

### Deployment checklist

- [ ] `npm test` and `npm run build` pass locally.
- [ ] No `.env`, `data/` or `*.db` files are committed (`git ls-files`).
- [ ] Secrets are set in the host's dashboard, not in the repository.
- [ ] `NODE_ENV=production`, `APP_URL` (https) and `DATABASE_PATH` on a persistent disk are set.
- [ ] HTTPS is on (cookies are `Secure` in production and won't work over plain http).
- [ ] `TRUST_PROXY=true` if the host puts a proxy in front of the app.
- [ ] `JSEARCH_MONTHLY_LIMIT` matches your JSearch plan.
- [ ] The first lines of the server log say AI / Job search / Reset email are `on` as expected, with no `[config]` warnings you didn't expect.
- [ ] Resend sender domain verified if you want password reset.
- [ ] The log shows `[backup] Wrote …` after start; copy a backup off the server now and then.
- [ ] `npm run check:production` (in the host's shell) shows no ✖.
- [ ] If Premium is on: live Stripe keys, live Price IDs and the live webhook secret are set; the log says `Premium billing: LIVE`; one real purchase, cancellation and refund were tested.

### Verify the deployed app

1. `https://your-app/healthz` returns `ok`.
2. Create an account, add an application, refresh, sign in from another browser — the data is there.
3. In a private window (signed out), Job Search asks you to sign in; signed in, a search returns listings.
4. **Settings → AI connection** shows Connected (if you set a key).
5. "Forgot password" sends an email (if Resend is configured).
6. **HTTPS:** the address bar shows a padlock on `https://your-app`. In PowerShell, `curl.exe -sI http://your-app/` should answer `301`, `302` or `308` with `Location: https://…` (your host or the app redirects), and `curl.exe -sI https://your-app/` should include `Strict-Transport-Security`.

---

## Security notes

- API keys live only on the server and are never sent to the browser.
- Passwords are hashed with scrypt and a random salt; sessions are random tokens stored hashed in the database, sent as `HttpOnly`, `SameSite=Lax` (and `Secure` in production) cookies.
- Every data request uses the user id from the session, so users can only read and write their own data.
- Each signed-in user has a monthly AI allowance (`AI_FREE_MONTHLY_LIMIT`), so one account can't run up your Anthropic bill.
- Billing:
  - No card data is stored: only Stripe customer and subscription IDs, the price, status and dates.
  - Checkout, portal and sync require sign-in and are rate limited.
  - The server chooses the price.
  - Webhooks are verified with `STRIPE_WEBHOOK_SECRET` against the raw body and processed once per event ID.
  - Premium is worked out from Stripe-verified subscription data on every request. No endpoint lets a user set their own plan.
  - Webhook payloads are never logged.
- State-changing API requests must be JSON from the same origin (CSRF protection). Sign-in, sign-up, reset, AI and job search are rate limited.
- The production server sends a Content-Security-Policy and other security headers, and blocks path traversal.
- Guest data stays in the browser's localStorage. When signed in, data is not copied into localStorage.

---

## Folder structure

```
first-job-ai/
├── server/
│   ├── index.js         Production server (static files + /api + security headers)
│   ├── api.js           Combines all /api routes, CSRF check, sign-in gate, rate limits
│   ├── auth.js          Accounts, sessions, password reset
│   ├── dataHandler.js   Per-user saved data with conflict detection
│   ├── db.js            SQLite database and migrations
│   ├── jobsHandler.js   JSearch job search (OpenWeb Ninja or RapidAPI)
│   ├── config.js        Checks settings at startup and explains problems
│   ├── aiHandler.js     Anthropic AI tasks
│   ├── plans.js         Free/Premium plans and the monthly AI allowance
│   ├── billing.js       Stripe Checkout, customer portal, webhooks
│   ├── billingStore.js  Subscriptions in the database and the Premium rule
│   └── http.js          Shared HTTP helpers and rate limiter
├── src/
│   ├── pages/           One file per page (JobSearch, CoverLetters, CareerAssistant, Auth, …)
│   ├── components/      Layout, UI pieces, jobs/ (job card, job picker), resume/
│   ├── context/         AuthContext (who's signed in), AppDataContext (data + sync), toasts
│   ├── lib/             Plain JS logic: jobs, recommend, careerText, transferable, resume, PDF, …
│   └── styles/
├── tests/               Automated tests (npm test)
├── .env.example         Template for settings (copy to .env)
└── vite.config.js       Dev server + the same /api routes
```

---

## Known limitations

The full launch-readiness list (what's complete, what still needs work, remaining security issues, the monetization plan) is in [docs/LAUNCH.md](docs/LAUNCH.md).

- Job listings depend on JSearch; availability, salaries and dates are only as accurate as the source. The app can't confirm a job is still open.
- Rate limits and the search cache are in memory: run a single server instance (or move them to a shared store such as Redis).
- SQLite (`node:sqlite`) is marked *experimental* by Node.js; it works on Node 22.13+ and 24, and the app hides the warning in `npm start`.
- Account data is saved as one document per user; two tabs editing at the same moment get a "changed in another tab" prompt rather than an automatic merge.
- Password reset email requires Resend. There is no email verification at sign-up yet.
- Interview answers are typed, not spoken. One resume per user; one PDF layout.

---

## Troubleshooting

**`npm` is not recognized** — Install Node.js, then fully close and reopen VS Code / PowerShell.

**"node:sqlite" or "No such built-in module"** — Your Node.js is too old. Install Node 22.13+ (or 24).

**Port 5173 is already in use** — Another copy is running. Close it, or use the address Vite prints.

**Job Search says it isn't set up** — Check `JSEARCH_API_KEY` in `.env` (file named exactly `.env`, no quotes/spaces), then restart `npm run dev`. The terminal's first lines say which integrations are on.

**"JSearch (OpenWeb Ninja) rejected the API key"** — The key is wrong, or your account isn't subscribed to JSearch. If your key is from RapidAPI and the message says OpenWeb Ninja, set `JSEARCH_PROVIDER=rapidapi`.

**Settings says AI "Not connected"** — Check `ANTHROPIC_API_KEY` and restart.

**"The AI model … was not found"** — `AI_MODEL` has a typo. Leave it blank to use the default.

**"Your Anthropic account is out of credit"** — Add credit at console.anthropic.com → Billing.

**Signed in but changes say "Not saved"** — The server couldn't be reached or another tab saved first; use the banner's buttons.

**My guest data disappeared** — Guest data is per browser. A different browser or a private window starts fresh. Create an account, or use Settings → Download backup.
