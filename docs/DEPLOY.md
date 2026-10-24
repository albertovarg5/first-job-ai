# Launching First Job AI

This guide takes First Job AI from your computer to a public website that accepts real Stripe payments. Do the steps **in order**. Real payments stay locked (`STRIPE_ALLOW_LIVE=false`) until step 7 confirms everything is set up.

Steps marked **(you)** need your login, money, identity or legal decisions. Nobody else can do them.

---

## 1. The hosting setup

First Job AI is **one Node.js server** (`npm start`). It serves the website and the API from the **same address**, so:
- there's no separate frontend URL to configure;
- no CORS setup is needed;
- login cookies just work.

Accounts, saved data and subscriptions live in **one SQLite database file**. The host must therefore:
- run a Node process that stays on (not "serverless");
- give it a **persistent disk** that survives restarts and redeploys.

**Recommended: [Render](https://render.com)**, using one web service with a 1 GB disk.
- **Why:** it deploys straight from GitHub, includes HTTPS certificates and custom domains, has a health check, logs and a Shell, and takes daily disk snapshots. The repository already contains the setup ([render.yaml](../render.yaml)).
- **Cost (you):** disks need a **paid** instance. The free tier can't keep a disk. At the time of writing that's roughly **$7/month** for the smallest paid instance plus about **$0.25 per GB per month** for the disk. Check the current prices at <https://render.com/pricing> before choosing.
- **Limits:** one instance only, which is fine for launch. Each deploy has a few seconds of downtime, because the disk must move from the old instance to the new one.
- **Alternatives** that also work: Railway (with a volume), Fly.io (with a volume), or a small VPS.

---

## 2. Put the code on GitHub (you)

1. Create a free account at <https://github.com>, then **New repository**:
   - Name: `first-job-ai`
   - Visibility: **Private**
   - Don't add a README.
2. In PowerShell:
   ```powershell
   cd C:\Users\alber\Downloads\first-job-ai\first-job-ai
   git status
   ```
   Check that `.env`, `data/` and any `.db` file are **not** listed. They're ignored on purpose.
3. Commit and push. Replace `YOUR-USERNAME`:
   ```powershell
   git add -A
   git commit -m "Prepare production launch"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/first-job-ai.git
   git push -u origin main
   ```
   The first push opens a GitHub sign-in window.

---

## 3. Create the service on Render (you: account and paid plan)

1. Sign up at <https://render.com> with your GitHub account, and add a payment method.
2. **New → Blueprint** → choose the `first-job-ai` repository. Render reads `render.yaml` and shows:
   - a web service called **first-job-ai** (build: `npm ci --include=dev && npm run build`, start: `npm start`, health check `/healthz`);
   - a **1 GB disk** mounted at `/var/data`.
3. Render asks for the values marked secret. For this first deploy use your **TEST** Stripe values:

   | Variable | What to enter |
   | --- | --- |
   | `APP_URL` | For now `https://first-job-ai.onrender.com`, or whatever address Render shows for your service. Change it in step 4. |
   | `ANTHROPIC_API_KEY` | Your Anthropic key (`sk-ant-…`) |
   | `JSEARCH_API_KEY` | Your JSearch key |
   | `RESEND_API_KEY`, `EMAIL_FROM` | Leave blank for now (password reset stays off) or see step 8 |
   | `STRIPE_SECRET_KEY` | **Test** secret key `sk_test_…` |
   | `STRIPE_WEBHOOK_SECRET` | Leave blank for a moment (step 5) |
   | `STRIPE_PRICE_MONTHLY` | Test monthly `price_…` |
   | `STRIPE_PRICE_YEARLY` | Test yearly `price_…` |

   These are already filled in by the blueprint:
   - `NODE_ENV=production`
   - `DATABASE_PATH=/var/data/first-job-ai.db`
   - `TRUST_PROXY=true`
   - `CLIENT_IP_HEADER=cf-connecting-ip`
   - `AI_MODEL=claude-sonnet-5-5`
   - `STRIPE_ALLOW_LIVE=false`
4. **Apply**, and wait for the deploy to finish. In the service's **Logs**, you should see:
   ```
   [First Job AI] AI: on · Job search: on (...) · ... · Premium billing: test mode
   [backup] Wrote /var/data/backups/first-job-ai-....db
   First Job AI is running at ...
   [First Job AI] Database: /var/data/first-job-ai.db
   ```
   If the database path is **not** `/var/data/…`, stop and fix `DATABASE_PATH`, otherwise accounts would vanish on the next deploy.
5. Open `https://YOUR-SERVICE.onrender.com/healthz`. It should show `ok`.

Secret values live only in Render's **Environment** tab. Never put them in `render.yaml`, in Git, or in a variable starting with `VITE_`.

---

## 4. Domain and HTTPS (you: buy a domain)

1. Buy a domain from any registrar, for example Cloudflare Registrar, Namecheap or Porkbun. Usually about $10–15 a year for a `.com`.
2. Render → your service → **Settings → Custom Domains → Add**. Enter `yourdomain.com` and/or `www.yourdomain.com`.
3. Render shows the DNS records to create (a `CNAME`, and for the bare domain an `A`/`ALIAS` record). Add exactly those at your registrar.
4. Wait until Render shows the domain as **Verified** with a certificate issued. That can take minutes to a few hours. Render renews HTTPS certificates automatically.
5. Render → **Environment**: set `APP_URL=https://yourdomain.com` (no trailing slash), save, and redeploy.

`APP_URL` is used for Stripe's return pages, password-reset links and the http→https redirect. Every other address redirects to it.

---

## 5. Test the real site with Stripe TEST mode

This proves the deployed site, database and webhooks work before any real money is involved.

1. Stripe Dashboard, **test mode / sandbox**, in the account your keys belong to:
   **Developers → Webhooks → Add endpoint**
   - Endpoint URL: `https://yourdomain.com/api/billing/webhook`
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
2. Render → Environment: set `STRIPE_WEBHOOK_SECRET` to that test `whsec_…`, then redeploy.
3. Render → service → **Shell**, and run:
   ```bash
   npm run check:production
   ```
   Fix every ✖. The ⚠ about a test key is expected at this stage.
4. On `https://yourdomain.com`:
   - sign up;
   - go to **Plans & Pricing → Subscribe monthly** and pay with `4242 4242 4242 4242`, any future date, any CVC;
   - you should return to "Welcome to Premium", and Settings should show **200** AI requests;
   - **Manage subscription** → cancel. It stays Premium until the period ends.
5. Stripe → Developers → Webhooks → your endpoint should show **200** responses.
6. Redeploy once more, then sign in again. Your account and subscription must still be there. That proves the disk is working.

---

## 6. Set up Stripe LIVE mode (you)

Test and live mode are completely separate in Stripe. Live mode has its own keys, products, prices, webhook endpoints and portal settings, and none of the test objects carry over.

### 6a. Activate the account (you, required by Stripe)

Stripe Dashboard → **Activate payments** (or Settings → Account details). Stripe asks for:
- **business type**, and your legal name or company name;
- address, date of birth, and a tax ID (for example the last digits of your SSN, or an EIN in the US), possibly with an ID document;
- what you sell, and your **website** (`https://yourdomain.com`);
- **bank account** for payouts (Settings → Business → Bank accounts and currencies);
- **public details** (Settings → Business → Public details): the name customers see on card statements, a **customer support email**, and the website.

Stripe reviews your website. Stripe's published requirements say it must clearly show:
- what you sell and the prices;
- how to contact you;
- your **refund and cancellation policy**;
- your **terms of service** and **privacy policy**.

See step 8.

### 6b. Create the live product and prices

Switch the Dashboard to **live mode**, then **Product catalog → Add product**:
- Name: `First Job AI Premium`
- Description, for example: "200 AI requests a month for job analysis, resume suggestions, cover letters and interview practice."
- Price 1: **Recurring**, **$9.99 USD**, billing period **Monthly** → Save.
- **Add another price**: **Recurring**, **$79.00 USD**, **Yearly** → Save.

Open each price and copy its ID (`price_…`). The monthly one goes in `STRIPE_PRICE_MONTHLY` and the yearly one in `STRIPE_PRICE_YEARLY`.

### 6c. Customer portal (live mode)

**Settings → Billing → Customer portal**:
- **Payment methods**: allow customers to update them.
- **Cancellations**: on, at the **end of the billing period**.
- **Subscriptions**: allow switching plans, and add both Premium prices.
- **Business information**: your terms of service and privacy policy links.
- **Save**.

### 6d. Failed payments (live mode)

**Settings → Billing → Subscriptions and emails → Manage failed payments**:
- keep **Smart Retries** on;
- after the last retry: **Cancel the subscription**.

The app also keeps Premium for at most 14 days after a payment fails.

### 6e. Live webhook endpoint

**Developers → Webhooks → Add endpoint** (live mode):
- the same URL, `https://yourdomain.com/api/billing/webhook`;
- the same **14 events** as in step 5.

Save, then reveal the **live** signing secret.

### 6f. Live API key

**Developers → API keys** (live mode) → **Secret key → Reveal**. It starts with `sk_live_`. Copy it directly into Render. Don't save it in a file, an email or a chat.

---

## 7. Switch the production site to live payments

1. Render → Environment, replacing the test values:

   | Variable | New value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | `sk_live_…` (6f) |
   | `STRIPE_WEBHOOK_SECRET` | live `whsec_…` (6e) |
   | `STRIPE_PRICE_MONTHLY` | live monthly `price_…` (6b) |
   | `STRIPE_PRICE_YEARLY` | live yearly `price_…` (6b) |
   | `STRIPE_ALLOW_LIVE` | still `false` |

   Save and deploy. The log should say `Premium billing: locked (live key without STRIPE_ALLOW_LIVE)`. Nobody can be charged yet.
2. Render → **Shell**:
   ```bash
   npm run check:production
   ```
   It checks, without changing anything:
   - the key is live and the account can take charges and pay out;
   - both prices are live, active, recurring and the right amounts;
   - the live webhook endpoint exists for your domain with every needed event;
   - the portal settings;
   - HTTPS and the http→https redirect;
   - the database disk;
   - your Anthropic key.

   Fix every ✖ until it prints **`READY: you can set STRIPE_ALLOW_LIVE=true and redeploy.`**
3. Render → Environment: set `STRIPE_ALLOW_LIVE=true`, save and deploy. The log should say `Premium billing: LIVE`.
4. **First real purchase (you, with your own card):**
   - subscribe monthly on your site;
   - check that Settings shows Premium, and that Stripe → Webhooks shows `200`;
   - Stripe → Payments → that payment → **Refund** the full amount;
   - check that your account returns to Free. That also tests refund handling.

   This one purchase costs you the Stripe fee on $9.99 (about $0.60 for a US card). Stripe doesn't return the fee when you refund.

**To switch real payments off at any time:** set `STRIPE_ALLOW_LIVE=false` and redeploy. Checkout closes immediately. Existing subscribers keep renewing in Stripe, and their webhooks are still processed.

---

## 8. Before you announce the launch (you)

- **Legal pages.** Publish a **Privacy Policy**, **Terms of Service** and a **Refund & cancellation policy**, plus a **support email**, and link them in Stripe (6a, 6c).
  - The app stores résumés, job applications and emails, so the privacy policy must say what you collect, why, which services process it (Stripe, Anthropic, JSearch, Render, Resend), and how people can delete their account. The app has a delete-account button.
  - The app doesn't include these pages yet. Write them, or have them drafted from your real business details, and get them reviewed for your country. They aren't legal advice from this guide.
- **Taxes.** Whether you must collect sales tax or VAT depends on where you and your customers are, and on your revenue. Stripe Tax can calculate and collect it (for an extra fee), but registering with tax authorities is your responsibility. Ask an accountant if unsure. The app doesn't turn on tax collection.
- **Password reset email.** Create a [Resend](https://resend.com) account, verify your domain there, and set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `First Job AI <no-reply@yourdomain.com>`). Until then, users who forget their password can't reset it.
- **Anthropic billing.** In console.anthropic.com → Billing: add credits or a payment method, and set a **monthly spend limit** you're comfortable with.
- **JSearch.** Set `JSEARCH_MONTHLY_LIMIT` to your plan's monthly request allowance.

---

## 9. Running it

- **Logs:** Render → Logs. Problems are logged with `[billing]`, `[error]`, `[health]` or `[config]` at the start.
- **Health:** Render checks `/healthz`, which also reads the database, and restarts the service if it fails. For alerts by email, add a free uptime monitor (for example UptimeRobot) on `https://yourdomain.com/healthz`.
- **Backups:**
  - Render snapshots the disk daily and keeps 7 days.
  - The app itself writes a consistent copy to `/var/data/backups/` at every start and every 24 hours, keeping 14.
  - For an extra one now: Render Shell → `npm run backup`.
  - Now and then, copy a backup to your computer using Render's SSH access (see Render's docs on SSH).
- **Deploys:** `render.yaml` sets auto-deploy **off**. After pushing to GitHub, click **Manual Deploy** in Render. Run `npm test` and `npm run build` on your computer first.
- **Refunds and disputes:**
  - A full refund of the latest payment, or a dispute, ends Premium automatically.
  - Partial refunds keep Premium.
  - Answer disputes in Stripe → Payments → Disputes.

---

## All environment variables

Set these in Render → Environment. The values below are placeholders.

| Variable | Production value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Set by the blueprint |
| `DATABASE_PATH` | `/var/data/first-job-ai.db` | Must be on the disk. Set by the blueprint |
| `APP_URL` | `https://yourdomain.com` | Public address, no trailing slash |
| `TRUST_PROXY` | `true` | Set by the blueprint |
| `CLIENT_IP_HEADER` | `cf-connecting-ip` | Real visitor IP for rate limits on Render |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Secret |
| `AI_MODEL` | `claude-sonnet-5-5` | Optional |
| `AI_FREE_MONTHLY_LIMIT` | *(blank = 20)* | Optional |
| `AI_PREMIUM_MONTHLY_LIMIT` | *(blank = 200)* | Optional |
| `JSEARCH_API_KEY` | `your-jsearch-key` | Secret |
| `JSEARCH_MONTHLY_LIMIT` | e.g. `200` | Your plan's allowance |
| `RESEND_API_KEY` | `re_...` | Secret, for password reset |
| `EMAIL_FROM` | `First Job AI <no-reply@yourdomain.com>` | Domain verified in Resend |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Secret. Test first: `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Secret. From the endpoint of the **same mode** |
| `STRIPE_PRICE_MONTHLY` | `price_...` | $9.99/month, same mode as the key |
| `STRIPE_PRICE_YEARLY` | `price_...` | $79/year, same mode as the key |
| `STRIPE_ALLOW_LIVE` | `false` → `true` in step 7 | Safety lock |

Optional: `BACKUP_DIR`, `BACKUP_KEEP` (default 14), `BACKUP_DISABLED`, `STRIPE_EXTRA_PREMIUM_PRICES` (old price IDs that should keep granting Premium).

**Keep test and live values apart.** Your local `.env` keeps the **test** values for development. Live values exist only in Render. The app refuses to charge a price whose mode doesn't match the key, and `npm run check:production` flags any mix-up.
