# Launching First Job AI (Railway + PostgreSQL + Vercel)

This guide takes First Job AI from your computer to a public website. Do the steps **in order**. Stripe stays in **test mode** until step 9. Real payments stay locked (`STRIPE_ALLOW_LIVE=false`) until step 10 confirms everything is set up.

Steps marked **(you)** need your login, money, identity or legal decisions. Nobody else can do them.

---

## 1. How the pieces fit together

```
Browser ──► Vercel (https://your-site)          React app (built from this repo)
              │  /api/*  and  /healthz  are forwarded ──►  Railway backend (npm start)
              │                                              │
              │                                              └──► Railway PostgreSQL (DATABASE_URL)
Stripe ─────────────────────────────── webhooks ──►  Railway backend /api/billing/webhook
```

- The browser only ever talks to **your Vercel address**. Vercel forwards `/api/...` to Railway ([vercel.json](../vercel.json)). Login cookies therefore stay on your own site, and **no CORS setup is needed**. The backend rejects state-changing requests from any other website.
- The backend runs **API-only** on Railway ([railway.json](../railway.json): start `npm start`, health check `/healthz`, restart if it crashes).
- Accounts, resumes, applications, AI usage and subscriptions live in **PostgreSQL**. The backend refuses to start on Railway without `DATABASE_URL`, so data can never silently go to a temporary disk.
- Secrets (`DATABASE_URL`, API keys, Stripe keys) exist **only in Railway's Variables**. Vercel needs **no** environment variables.

**Costs (you):** Railway bills by usage (check <https://railway.com/pricing>). Vercel's free Hobby plan is for personal, non-commercial projects; a paid product should use Vercel Pro (check <https://vercel.com/pricing>).

---

## 2. Put the code on GitHub (you)

Your repository is `https://github.com/albertovarg5/first-job-ai`. In PowerShell:

```powershell
cd C:\Users\alber\Downloads\first-job-ai\first-job-ai
git status
```

Check that `.env`, `data/` and any `.db` file are **not** listed (they're ignored on purpose). Then commit and push your branch, and merge it into `main` on GitHub (Pull request → Merge). Railway and Vercel deploy `main`.

---

## 3. Create the Railway project and PostgreSQL (you: account)

1. Sign up at <https://railway.com> with your GitHub account and add a payment method.
2. **New Project → Deploy from GitHub repo →** `albertovarg5/first-job-ai`. Railway creates a service for the backend and reads `railway.json`. The first deploy will **fail on purpose** (no database yet). That's expected.
3. In the same project: **+ Create → Database → PostgreSQL**. A service called **Postgres** appears.
4. Optional but recommended: Postgres service → **Backups** → turn on scheduled backups (if your plan offers them).

---

## 4. Configure the backend's variables (you)

Railway → the **first-job-ai** service (not Postgres) → **Variables** → **New Variable**. Type each value directly into Railway. Never paste secrets into chat, email or Git.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`: type it exactly like this. It's a *reference*: Railway fills in the private database address. |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `true` |
| `APP_URL` | For now `https://example.com`. You'll set the real Vercel address in step 6. |
| `ALLOWED_ORIGINS` | Optional. Leave it out unless you test on a Vercel preview: then the preview's exact `https://` address (e.g. the branch alias `https://<project>-git-<branch>-<team>.vercel.app`), comma-separated. No wildcards. Reset links always use `APP_URL`. |
| `ANTHROPIC_API_KEY` | Your Anthropic key (`sk-ant-…`) |
| `AI_MODEL` | `claude-sonnet-5-5` (optional) |
| `JSEARCH_API_KEY` | Your JSearch key |
| `JSEARCH_MONTHLY_LIMIT` | Your JSearch plan's monthly allowance (optional) |
| `STRIPE_SECRET_KEY` | Your **TEST** secret key `sk_test_…` |
| `STRIPE_PRICE_MONTHLY` | **Test** monthly `price_…` ($9.99/month) |
| `STRIPE_PRICE_YEARLY` | **Test** yearly `price_…` ($79/year) |
| `STRIPE_WEBHOOK_SECRET` | Leave it out for now (step 8) |
| `STRIPE_ALLOW_LIVE` | `false` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional, for password-reset email (step 11) |

Don't set `PORT`: Railway provides it and the app uses it.

Then **Settings → Networking → Generate Domain**. You get an address like `first-job-ai-production.up.railway.app`. Write it down: this is your **backend address**.

---

## 5. Deploy the backend and check it (you)

1. Railway redeploys after you change variables (or click **Deploy**). Open the service's **Deployments → View logs**. You should see:
   ```
   [First Job AI] API-only (expected on Railway): the frontend is built and served by Vercel ...
   [First Job AI] AI: on · Job search: on (...) · ... · Premium billing: test mode
   First Job AI is running at http://localhost:8080
   [First Job AI] Database: PostgreSQL at postgres.railway.internal:5432/railway
   ```
   If the log says `DATABASE_URL is not set`, go back to step 4. (`localhost` in that line is normal: it's the port inside Railway.)
2. Open `https://YOUR-BACKEND.up.railway.app/healthz` in your browser. It must show `ok`. This also proves the database answers.
3. Open `https://YOUR-BACKEND.up.railway.app/` → it says "This is the First Job AI API server". That's correct: the app itself comes from Vercel.

### 5b. Move your existing accounts and data into PostgreSQL (optional, recommended)

Your current accounts, resumes, applications, AI usage and subscription records are in `data\first-job-ai.db`. Copy them into Railway's database **before anyone signs up online** (the import only runs into an empty database):

1. Railway → **Postgres** service → **Variables** → copy `DATABASE_PUBLIC_URL` (this one works from your computer).
2. In PowerShell (the address stays in this window only, not in any file):
   ```powershell
   cd C:\Users\alber\Downloads\first-job-ai\first-job-ai
   $env:DATABASE_URL = "PASTE-DATABASE_PUBLIC_URL-HERE"
   npm run db:import
   Remove-Item Env:DATABASE_URL
   ```
3. It prints the rows copied per table, checked against the database. If anything fails, **nothing** is written. Your SQLite file is never changed, and a copy is saved in `data\backups\` first. Keep both.

If you see an SSL error, add `?sslmode=no-verify` to the end of the address and run it again.

Note: subscriptions you made in Stripe **test** mode come along, but they never grant Premium once live keys are used (test and live data are kept apart).

---

## 6. Deploy the frontend to Vercel and connect both (you: account)

1. **Point Vercel at your backend.** In [vercel.json](../vercel.json), replace `YOUR-BACKEND.up.railway.app` (two places) with your backend address from step 4. Commit and push to `main`:
   ```powershell
   git add vercel.json
   git commit -m "Point /api to the Railway backend"
   git push
   ```
   (A Vercel build with the placeholder still in place stops with a clear error, so you can't accidentally launch a site whose API doesn't work.)
2. Sign up at <https://vercel.com> with GitHub. **Add New → Project → Import** `albertovarg5/first-job-ai`.
   - Framework: **Vite** (detected). Build command `npm run build`, output `dist` (both come from `vercel.json`).
   - Environment variables: **none**. Don't copy any keys to Vercel.
   - **Deploy.**
3. Vercel shows your site address, e.g. `https://first-job-ai.vercel.app` (or add your own domain: Project → **Settings → Domains**).
4. **Connect both:** Railway → backend → Variables → set `APP_URL` to that exact address (`https://…`, no trailing slash). Railway redeploys.
   `APP_URL` is used for Stripe's return pages and password-reset links, and to accept the requests Vercel forwards.

---

## 7. Test the whole app online (you)

On your Vercel address:

1. `https://YOUR-SITE/healthz` shows `ok` (this goes Vercel → Railway → PostgreSQL).
2. **Create an account**, sign out, sign in again. Try a wrong password: it's refused.
3. **Resume Builder:** write a summary, save. **Job Tracker:** add an application. Refresh the page: both are still there.
4. Open `https://YOUR-SITE/settings` directly and press **F5**: the page loads (no 404).
5. **AI:** use an AI tool (e.g. the summary helper). **Settings → AI connection** says Connected, and the usage count goes up.
6. **Job Search:** search "office assistant": real listings appear.
7. **Privacy:** in a private window, create a second account. It sees none of the first account's data.
8. **Persistence:** Railway → backend → **Redeploy**. Sign in again: everything is still there.

---

## 8. Stripe TEST mode online (you)

1. Stripe Dashboard, **test mode / sandbox**: **Developers → Webhooks → Add endpoint** (or *Add destination*):
   - Endpoint URL: `https://YOUR-BACKEND.up.railway.app/api/billing/webhook` (straight to Railway).
   - API version: `2026-09-30.endive` (the version of the installed `stripe` package).
   - Events. Select these 14:
     ```
     checkout.session.completed
     checkout.session.async_payment_succeeded
     checkout.session.async_payment_failed
     customer.subscription.created
     customer.subscription.updated
     customer.subscription.deleted
     customer.subscription.paused
     customer.subscription.resumed
     customer.subscription.trial_will_end
     invoice.paid
     invoice.payment_succeeded
     invoice.payment_failed
     charge.refunded
     charge.dispute.created
     ```
   - Save, then **Reveal** the signing secret (`whsec_…`).
2. Railway → backend → Variables: `STRIPE_WEBHOOK_SECRET` = that test `whsec_…`.
3. Test mode needs both prices: Stripe (test mode) → Product catalog → your Premium product must have **$9.99 monthly** and **$79 yearly** recurring prices, and their IDs must be in `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
4. Test mode → **Settings → Billing → Customer portal**: allow card updates, cancellation at period end, switching between both prices, add your terms/privacy links, **Save**.
5. Run the read-only check **inside** the Railway service (it can reach the private database there):
   ```powershell
   npm install -g @railway/cli
   railway login
   railway link        # choose the project and the backend service
   railway ssh         # opens a shell inside the running backend
   npm run check:production
   exit
   ```
   Fix every ✖ it reports. The ⚠ about a test key is expected now.
6. On your site: **Plans & Pricing → Subscribe monthly**, pay with `4242 4242 4242 4242`, any future date, any CVC. You return to "Welcome to Premium". Settings shows Premium with the higher AI allowance.
7. **Manage subscription** → cancel. It stays Premium until the period ends. Stripe → Webhooks → your endpoint shows `200` for each event.
8. Try **yearly** too.

---

## 9. Set up Stripe LIVE mode (you)

Test and live mode are completely separate in Stripe. Live mode has its own keys, products, prices, webhook endpoints and portal settings, and none of the test objects carry over.

**One Stripe account per business.** Your current Stripe account also has a webhook for another project. Customers see the account's name, support email and card-statement name, so consider a separate Stripe account for First Job AI (Stripe lets one login own several accounts). First Job AI ignores customers it didn't create either way.

### 9a. Activate the account (required by Stripe)

Stripe Dashboard → **Activate payments**: business type and legal name, address, tax ID, what you sell, your **website** (your Vercel address or domain), **bank account** for payouts, and **public details** (statement name, **support email**). Stripe reviews the website: it must show what you sell and the prices, how to contact you, your refund/cancellation policy, terms of service and privacy policy (step 11).

### 9b. Live product and prices

Switch the Dashboard to **live mode** → **Product catalog → Add product**:
- Name: `First Job AI Premium`
- Price 1: **Recurring**, **$9.99 USD**, **Monthly**
- **Add another price**: **Recurring**, **$79.00 USD**, **Yearly**

Copy each live price ID (`price_…`).

### 9c. Customer portal (live mode)

**Settings → Billing → Customer portal**: update payment methods on; cancellations on, **at the end of the billing period**; switching plans on with both Premium prices; terms and privacy links; **Save**.

### 9d. Failed payments (live mode)

**Settings → Billing → Subscriptions and emails → Manage failed payments**: keep **Smart Retries** on; after the last retry **cancel the subscription**. (The app keeps Premium for at most 14 days after a failed payment.)

### 9e. Live webhook endpoint

**Developers → Webhooks → Add endpoint** in **live** mode: the same Railway URL, API version `2026-09-30.endive`, the same 14 events. Save, then reveal the **live** signing secret.

### 9f. Live API key

**Developers → API keys** (live mode) → **Secret key → Reveal** (`sk_live_…`). Type it straight into Railway in step 10. The app never needs the publishable key.

---

## 10. Switch to live payments (only when you decide to)

1. Railway → backend → Variables, replacing the test values:

   | Variable | New value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | `sk_live_…` (9f) |
   | `STRIPE_WEBHOOK_SECRET` | live `whsec_…` (9e) |
   | `STRIPE_PRICE_MONTHLY` | live monthly `price_…` (9b) |
   | `STRIPE_PRICE_YEARLY` | live yearly `price_…` (9b) |
   | `STRIPE_ALLOW_LIVE` | still `false` |

   The log should now say `Premium billing: locked (live key without STRIPE_ALLOW_LIVE)`. Nobody can be charged yet. Test subscriptions from step 8 stop counting: with a live key the app only reads live-mode customers and subscriptions.
2. `railway ssh` → `npm run check:production`. Fix every ✖ until it prints **`READY: you can set STRIPE_ALLOW_LIVE=true and redeploy.`**
3. Set `STRIPE_ALLOW_LIVE=true`. The log says `Premium billing: LIVE`.
4. **First real purchase (with your own card):** subscribe monthly, check Settings shows Premium and the live webhook shows `200`, then Stripe → Payments → **Refund** the full amount and check your account returns to Free. (This costs the Stripe fee on $9.99, about $0.60 for a US card; Stripe keeps the fee on refunds.)

**To switch real payments off at any time:** set `STRIPE_ALLOW_LIVE=false`. Checkout closes immediately; existing subscribers keep renewing and their webhooks are still processed.

---

## 11. Before you announce the launch (you)

- **Legal pages:** Privacy Policy, Terms of Service, Refund & cancellation policy and a support email, linked in Stripe (9a, 9c). The privacy policy must name the services that process data: Stripe, Anthropic, JSearch, Railway, Vercel, Resend. Get them reviewed for your country.
- **Taxes:** whether you must collect sales tax/VAT depends on where you and your customers are. Stripe Tax can help (extra fee); registering is your responsibility.
- **Password reset email:** [Resend](https://resend.com) account, verified domain, then `RESEND_API_KEY` and `EMAIL_FROM` on Railway.
- **Anthropic:** add credits and set a monthly spend limit at console.anthropic.com → Billing.
- **JSearch:** set `JSEARCH_MONTHLY_LIMIT` to your plan's allowance.

---

## 12. Running it

- **Logs:** Railway → backend → Deployments → View logs. Problems start with `[billing]`, `[error]`, `[health]`, `[db]` or `[config]`.
- **Health:** Railway checks `/healthz` (which also queries the database) during each deploy and restarts the backend if it crashes. For alerts, add a free uptime monitor on `https://YOUR-SITE/healthz`.
- **Backups:** Railway Postgres backups (step 3), plus now and then a copy on your computer:
  ```powershell
  $env:DATABASE_URL = "PASTE-DATABASE_PUBLIC_URL-HERE"
  npm run backup
  Remove-Item Env:DATABASE_URL
  ```
  This writes `data\backups\first-job-ai-<date>.db`. To restore into an **empty** database: `npm run db:import -- data\backups\first-job-ai-<date>.db`.
- **Deploys:** pushing to `main` redeploys both Railway and Vercel. Run `npm test` and `npm run build` on your computer first.
- **One backend instance:** keep Railway at 1 replica (rate limits and the search cache are in memory).

---

## All backend environment variables (Railway)

| Variable | Production value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Required. Reference to the Railway Postgres service |
| `NODE_ENV` | `production` | |
| `APP_URL` | `https://YOUR-SITE` | The Vercel address or your domain, no trailing slash |
| `TRUST_PROXY` | `true` | |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Secret |
| `AI_MODEL` | `claude-sonnet-5-5` | Optional |
| `AI_FREE_MONTHLY_LIMIT` / `AI_PREMIUM_MONTHLY_LIMIT` | *(blank = 20 / 200)* | Optional |
| `JSEARCH_API_KEY` | `your-jsearch-key` | Secret |
| `JSEARCH_MONTHLY_LIMIT` | e.g. `200` | Your plan's allowance |
| `RESEND_API_KEY` / `EMAIL_FROM` | `re_...` / `First Job AI <no-reply@yourdomain.com>` | Password reset |
| `STRIPE_SECRET_KEY` | `sk_test_...` → `sk_live_...` in step 10 | Secret |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Secret. From the endpoint of the **same mode** |
| `STRIPE_PRICE_MONTHLY` | `price_...` | $9.99/month, same mode as the key |
| `STRIPE_PRICE_YEARLY` | `price_...` | $79/year, same mode as the key |
| `STRIPE_ALLOW_LIVE` | `false` → `true` in step 10 | Safety lock |

Optional: `STRIPE_EXTRA_PREMIUM_PRICES` (old price IDs that should keep granting Premium), `BACKUP_DIR` (a Railway volume path, turns on daily snapshots), `BACKUP_KEEP`.

Vercel: **no variables.** Only `vercel.json` must name the backend address.

**Keep test and live values apart.** Your local `.env` keeps the **test** values. Live values exist only in Railway. The app refuses to charge a price whose mode doesn't match the key, ignores webhook events from the other mode, and `npm run check:production` flags any mix-up.
