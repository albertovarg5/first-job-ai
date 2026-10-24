# First Job AI: launch readiness

This page is an honest status report for taking First Job AI public. It lists what is finished and tested, what still needs work, the security issues that remain, and a plan for a future paid plan. It contains no invented users, numbers or revenue.

Last updated: October 2026.

---

## 1. External services you need

| Service | What it powers | Required? | Cost model | Where to get it |
| --- | --- | --- | --- | --- |
| **Anthropic API** | AI tools: job analysis, resume suggestions, cover letters, interview questions and feedback, summaries | Optional (Basic mode works without it) | Pay per token used | console.anthropic.com → API keys and Billing |
| **JSearch** (OpenWeb Ninja or RapidAPI) | Real job listings | Optional (Job Search shows setup steps without it) | Free tier, then monthly plans by number of requests | app.openwebninja.com or rapidapi.com |
| **Stripe** | Premium subscriptions (Checkout, Billing, customer portal) | Optional (without it every account is Free) | A fee per successful payment, no monthly fee | dashboard.stripe.com |
| **Resend** | Password-reset emails | Required in production for password reset | Free tier, then monthly plans | resend.com (needs a verified sending domain) |
| **Hosting with a persistent disk** | Runs `npm start` and keeps the SQLite file | Required to go live | Monthly | For example Render, Railway or Fly.io, or a small VPS |
| **Domain name + HTTPS** | Public address, secure cookies | Required to go live | Yearly | Any registrar; most hosts provide HTTPS |

Deployment steps are in the README under **Deployment**.

---

## 2. Features that are complete

These features work end to end and are covered by automated tests. The application workflow was also checked in a real browser, on desktop and on a phone-sized screen.

- **Accounts:** sign up, sign in, sign out, password reset (email in production; link printed in the terminal during development), change password, delete account.
- **Private data:** each user's tracker, saved jobs, resume, letters and practice sessions are stored in SQLite and can only be read with that user's session. The data survives a refresh, signing out and back in, and a server restart.
- **Real job search** through JSearch: title, location, remote, job type, date posted, experience and country filters. Includes paging, caching and a monthly request cap. The app never shows made-up listings, and it explains a missing key, a rejected key, rate limits and empty results.
- **Saved jobs and tracker:** six statuses, status history, dates, notes, interview times, duplicate protection, and list and board views.
- **Application workspace** (`/tracker/<id>`): a guided path for one job with a single clear next step:
  1. Add the job description.
  2. Analyze the requirements.
  3. Tailor your resume.
  4. Write a cover letter.
  5. Apply.
  6. Practice the interview.

  Each step is marked done from real activity (for example, a saved cover letter linked to this job), not by a manual checkbox.
- **Job requirements analysis:** with AI, the job's requirements are split into required and nice-to-have, and resume evidence is shown only when it is an exact quote that really appears in the resume. Without AI, a keyword analysis is used instead. The server refuses to analyze a job without a description.
- **Resume Builder** with PDF export and a **Tailor to a job** comparison.
- **Cover letters** that only use the resume and the user's notes. Requirements the resume doesn't show are listed as gaps.
- **Interview practice** with AI or library questions, feedback and history.
- **Dashboard** with "Your next steps" for open applications, the pipeline, upcoming interviews and activity.
- **Plans and AI allowance:** AI use is counted per signed-in user and month (Free 20, Premium 200, both configurable). Failed requests don't count, and users see their usage in Settings.
- **Premium subscriptions with Stripe** (monthly, plus yearly if configured):
  - Stripe-hosted Checkout, and a customer portal for changing the card, switching plans and canceling.
  - Signature-verified, idempotent webhooks, and safe handling of failed payments, cancellation, expiry, full refunds and disputes.
  - Subscriptions are canceled when an account is deleted.
  - Live-mode safety lock: a live key takes no payments until `STRIPE_ALLOW_LIVE=true`. Production redirects plain `http://` to `https://`, and live billing refuses to start without an `https://` `APP_URL`.
  - Tested with 24 automated tests (fake Stripe API, real signature checks), and in a browser against the built app with a fake Stripe. **Not yet tested against a real Stripe account.** See the next section.

## 3. Features that still need work

Listed in rough priority order for a public launch:

1. **Email verification at sign-up.** Anyone can create accounts with addresses they don't own.
2. **A real Stripe test-mode run-through.** The payment code is finished and tested with a simulated Stripe, but it has not yet run against a real Stripe test-mode account. Follow "Premium subscriptions (Stripe)" in the README, including cancellation, a failed payment, a refund and a dispute, before charging anyone.
3. **Terms of Service and Privacy Policy pages.** Required before collecting real users' resumes. Have them reviewed for your country.
4. **Error monitoring and uptime alerts.** For example Sentry and an uptime checker. Today, errors only appear in the server log.
5. **Database backups.** The SQLite file needs scheduled off-site backups.
6. **Analytics.** There is no measurement of which steps users finish, so you can't yet tell which features are valuable enough to charge for (see section 5).
7. **Code splitting.** The JavaScript bundle is about 490 KB, which is slower to load on phones.
8. **One resume per user and one PDF layout.** Users applying to different kinds of jobs may want several versions.
9. **Interview practice is typed only** (no voice).

## 4. Remaining security issues

The basics are in place: passwords are hashed with scrypt, session tokens are stored hashed in HttpOnly cookies, there is CSRF protection, rate limits and security headers, API keys stay on the server, and the build is blocked if a secret is named `VITE_*`. Still open:

| Issue | Risk | Suggested fix |
| --- | --- | --- |
| No email verification | Fake or mistyped accounts; someone could sign up with another person's address | Send a verification link with Resend before AI and job search unlock |
| Rate limits and AI counters for guests are in memory | Limits reset on restart and don't work across several servers | Run one instance, or move limits to Redis |
| If `API_REQUIRE_AUTH=false` in production, guests have no monthly AI cap (only the rate limiter) | Your Anthropic bill | Keep the default (`true`) in production |
| No account lockout beyond rate limits, and no two-factor sign-in | Password guessing on weak passwords | Fine for launch; add 2FA later |
| Resumes and job notes are stored unencrypted in SQLite | A stolen server disk exposes personal data | Use your host's disk encryption, restrict server access, back up to encrypted storage |
| SQLite via `node:sqlite` is marked experimental by Node.js | A future Node version could change it | Pin the Node version on your host (22.13+ or 24) |
| No automated dependency scanning | Vulnerable packages could go unnoticed | Run `npm audit` before each deploy, or turn on GitHub Dependabot |
| Stripe objects created by hand in the Dashboard (not through the app) are ignored | A subscription you create manually won't give anyone Premium | Always let users subscribe through the app's Upgrade button |
| A user could open Checkout in two browsers at the exact same moment | In rare cases, two subscriptions | The app closes other open checkouts and refuses a second purchase, but two clicks within the same second could both get through. Check Stripe's Subscriptions list and refund any duplicate |
| Webhooks processed at the same moment for one subscription | A stale state could briefly be saved | Every event re-reads the subscription from Stripe, so the next event or the 3-day expiry safeguard corrects it |
| The past-due grace period (14 days) and expiry safeguard (3 days) are fixed in code | They may not match your Stripe retry settings | Set Stripe's failed-payment rules to cancel after retries; change the constants in `server/billingStore.js` if needed |
| AI output is shown to the user | The model can still make mistakes | The app labels AI output, removes resume quotes that don't exist, and keeps Basic mode; keep the "check before relying on it" notes |

## 5. Monetization

Premium is implemented with Stripe but **switched off until you configure Stripe**. While developing, use only test-mode keys: no real money moves. Don't switch to live keys before completing the test-mode checklist in the README.

### How it works

- **Free:** account, real job search, saved jobs, the full tracker and workspace, Basic-mode tools, and 20 AI requests a month.
- **Premium:** the same, with 200 AI requests a month. Nothing else is advertised, because nothing else is different yet.
- **Price:** set in Stripe. The app shows the amount Stripe returns for the configured Price IDs, so the page and the charge can't disagree. See "Suggested pricing" below.
- **Who is Premium:** decided only on the server, from subscription data Stripe confirmed. That means a verified webhook, or the success page asking the server to check the checkout session with Stripe. The browser can't change it, and neither can editing saved data.
- **What is stored:** the Stripe customer ID and subscription ID, the price, status, period end, cancellation state, and processed webhook event IDs. No card data.

### Suggested pricing

| | Free | Premium monthly | Premium yearly |
| --- | --- | --- | --- |
| Price | $0 | **$9.99 / month** | **$79 / year** (the app shows "Save 34%") |
| AI requests a month | 20 (the default) | 200 (the default) | same as monthly |
| Everything else | All tools, unlimited Basic mode | Same | Same |

Why these numbers:
- **Your cost per AI request.** The default model, Claude Sonnet 5.5, costs $2 per million input tokens and $10 per million output tokens. A typical request here (a resume plus a job posting in, a few paragraphs out) is roughly $0.02–0.05. This is an estimate: check your real spend under console.anthropic.com → Usage after a week of real traffic.
- **A Premium user who uses all 200 requests** costs you about $4–10, and Stripe keeps about $0.59 of a $9.99 US card payment (2.9% + 30¢). At 300 requests a heavy user could cost more than they pay, so start at 200 and raise the limit once you know real usage.
- **Free users cost money too.** 20 requests is enough to try every AI tool, and costs at most about $0.40–1.00 per active free user a month.
- **$9.99** is below what students usually pay for comparable career tools, and job hunting often lasts only a few months, so monthly matters more than yearly. Yearly at $79 is for people who want the app through a whole graduation year.
- Limits are environment variables, so you can change them without code changes. Prices are changed in Stripe: create a new Price, put its ID in `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_YEARLY`, and keep the old ID in `STRIPE_EXTRA_PREMIUM_PRICES` so existing subscribers stay Premium.

### What you keep per subscriber (estimate)

This uses Stripe's standard US pricing: 2.9% + $0.30 per successful card payment, plus about 0.7% for Stripe Billing on subscriptions. Confirm current rates for your country at stripe.com/pricing. International cards (+1.5%) and currency conversion (+1%) cost more.

| | Customer pays | Card fee | Billing fee | **You receive** | Per month |
| --- | --- | --- | --- | --- | --- |
| Monthly | $9.99 | $0.59 | $0.07 | **≈ $9.33** | $9.33 |
| Yearly | $79.00 | $2.59 | $0.55 | **≈ $75.86** | ≈ $6.32 |

Example: 100 monthly subscribers bring in about **$933 a month** after Stripe fees. That is not profit. Still to subtract:
- **AI usage:** about $0.02–0.05 per request, so up to roughly $4–10 for a Premium user who uses all 200, and up to about $0.40–1.00 for an active Free user.
- **Hosting:** Render at roughly $7–8 a month at launch, plus the domain (about $10–15 a year).
- **Other services:** JSearch and Resend plans, if you go beyond their free tiers.
- **Refunds, disputes and chargeback fees.**
- **Sales tax or VAT** you collect and pass on, and **income tax** on the profit.

Watch the real numbers for the first month: Anthropic Console → Usage, Stripe → Balance.

### Refunds and disputes

- To refund someone, refund their **latest payment in full** in the Stripe Dashboard. The app then cancels their subscription and moves them to Free automatically.
- A partial refund is treated as a goodwill credit: they stay Premium.
- A dispute (chargeback) cancels the subscription immediately, so the customer isn't billed again. Respond to the dispute in the Dashboard (Payments → Disputes).

### What could justify Premium later

The AI tools cost real money per request; job search, the tracker and Basic mode cost almost nothing. That's why the AI allowance is the Premium benefit today. Possible future Premium additions, only if users ask for them: several resume versions, extra PDF layouts, voice interview practice.

**Before charging, measure.** Add analytics (section 3, item 6) and watch:

- How many free users reach the monthly AI limit.
- Which steps they use most.
- Whether users who complete the workflow report interviews and offers in their tracker.

Charge for what heavy users already depend on, not for features you guess are impressive.

### Rough cost check

AI cost per request depends on the model and the length of the resume and posting. Check the real numbers in the Anthropic Console (Usage) after a few weeks of testing, and set prices and limits from those numbers. This page does not include price estimates because none have been measured yet.

## 6. Launch checklist

- [ ] Rotate any API key that was ever pasted in a chat, screenshot or commit, and keep the new keys only in the host's environment settings.
- [ ] Deploy with `NODE_ENV=production`, HTTPS, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, and `DATABASE_PATH` on a persistent disk.
- [ ] Set `JSEARCH_MONTHLY_LIMIT` to your JSearch plan's allowance.
- [ ] Set `AI_FREE_MONTHLY_LIMIT` to what you can afford per user.
- [ ] Set a monthly spend limit in the Anthropic Console.
- [ ] Stripe: complete the test-mode checklist in the README (subscribe, cancel, failed payment, renewal with a test clock). Only then create live products, the live webhook endpoint and live keys. Make one real purchase, then cancel and refund it.
- [ ] Publish Terms and Privacy pages.
- [ ] Set up backups and error alerts.
- [ ] Run `npm test` and `npm run build`, then go through the manual checklist in the README on the live site.
