# First Job AI: launch readiness

This page is an honest status report for taking First Job AI public. It lists what is finished and tested, what still needs work, the security issues that remain, and a plan for a future paid plan. It contains no invented users, numbers or revenue.

Last updated: October 2026.

---

## 1. External services you need

| Service | What it powers | Required? | Cost model | Where to get it |
| --- | --- | --- | --- | --- |
| **Anthropic API** | AI tools: job analysis, resume suggestions, cover letters, interview questions and feedback, summaries | Optional (Basic mode works without it) | Pay per token used | console.anthropic.com → API keys and Billing |
| **JSearch** (OpenWeb Ninja or RapidAPI) | Real job listings | Optional (Job Search shows setup steps without it) | Free tier, then monthly plans by number of requests | app.openwebninja.com or rapidapi.com |
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
- **Plans and AI allowance:** every account is on Free. AI use is counted per user and month, failed requests are not counted, and users see their usage in Settings.

## 3. Features that still need work

Listed in rough priority order for a public launch:

1. **Email verification at sign-up.** Anyone can create accounts with addresses they don't own.
2. **Payments (Premium).** Not built, on purpose. See section 5.
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
| AI output is shown to the user | The model can still make mistakes | The app labels AI output, removes resume quotes that don't exist, and keeps Basic mode; keep the "check before relying on it" notes |

## 5. Monetization plan (not built yet)

**Nothing is charged today.** There are no upgrade buttons, no prices on the site, and no payment code.

### What is already prepared

- `server/plans.js` defines **Free** and **Premium** with a monthly AI allowance for each, configurable through `AI_FREE_MONTHLY_LIMIT` and `AI_PREMIUM_MONTHLY_LIMIT`.
- The database stores each user's plan (`users.plan`, default `free`) and AI usage per month (`ai_usage`).
- `/api/usage` returns the plan and allowance, and Settings displays it.
- **Adding Stripe later** would mean:
  1. A Stripe Checkout page.
  2. A webhook route that sets `users.plan` to `premium` when a subscription starts and back to `free` when it ends.
  3. A "Manage subscription" link to the Stripe customer portal.

  No other code needs to change, because the allowance already reads the plan from the database.

### What could justify Premium

The AI tools cost real money per request; job search, the tracker and Basic mode cost almost nothing. So it makes sense to:

- **Keep free:** account, real job search, saved jobs, the full tracker and workspace, Basic-mode analysis, resume builder and PDF, plus a limited number of AI requests a month (30 by default).
- **Premium candidates:** many more AI requests (job analysis, tailored suggestions, cover letters, interview questions and feedback), plus future additions that are genuinely useful, such as several resume versions, extra PDF layouts and voice interview practice.

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
- [ ] Publish Terms and Privacy pages.
- [ ] Set up backups and error alerts.
- [ ] Run `npm test` and `npm run build`, then go through the manual checklist in the README on the live site.
