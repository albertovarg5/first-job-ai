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
| **Job Tracker** | Add, edit and delete applications. Statuses: Interested, Applying, Applied, Interview, Offer, Rejected. Dates, notes, interview times, status history. Duplicate entries are blocked. List and Board views. |
| **Resume Builder** | Guided sections, "Improve wording", **Draft summary from my resume**, completeness score, live preview, **PDF download**, and **Tailor to a job**. |
| **Cover Letters** | Pick a saved/tracked job or paste a posting. Drafts use only your resume and your own notes; requirements you don't show are listed as gaps instead of being claimed. Edit, save, copy, download PDF. |
| **Interview Practice** | Questions from a built-in library, from skills named in a job description, or (with AI) generated for the job. Written answers, feedback (AI or automated checklist), history. |
| **Career Assistant** | Preferences (role, location, interests, job types). Recommended jobs ranked against your resume, with **"Why it may fit"** (checkable facts) kept separate from **"Check before applying"**. Transferable skills with the exact resume line as evidence, and practical ways to strengthen your qualifications. |
| **Experience Translator** | Describe what you did in plain words → editable resume bullets. |
| **Career Missions** | Three small tasks per day, streaks and history. |
| **Dashboard** | Progress, pipeline by status, saved jobs, upcoming interviews, missions, recent activity — all from your real data. |
| **Accounts** | Sign up, sign in, sign out, password reset, change password, delete account. Copy guest data into a new account. |
| **Settings** | Profile, account, AI connection, backup/restore, delete all data. |

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
| `DATABASE_PATH` | Accounts | SQLite file. Default `data/first-job-ai.db`. Use a persistent disk in production. |
| `APP_URL` | Password reset (production) | Public URL of the site, e.g. `https://firstjob.example.com`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Password reset emails | From <https://resend.com>, with a verified sender domain. |
| `PORT` | Optional | Production port (default 3000). |
| `TRUST_PROXY` | Optional | `true` behind a proxy that sets `X-Forwarded-For` (for correct rate limiting). |
| `COOKIE_SECURE` | Optional | Defaults to `true` in production. Only set `false` to test the production build over plain `http://`. |
| `API_REQUIRE_AUTH` | Optional | Defaults to `true` in production: only signed-in users can use AI/job search (protects your paid keys). |

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

Example: **Render**

1. Push the repository to GitHub (`.env` and `data/` are ignored — check with `git status`).
2. New **Web Service** → your repo. Build command: `npm install && npm run build`. Start command: `npm start`.
3. Add a **Disk** mounted at `/var/data`; set `DATABASE_PATH=/var/data/first-job-ai.db`.
4. Set environment variables in the dashboard: `NODE_ENV=production`, `APP_URL=https://<your-app>.onrender.com`, `TRUST_PROXY=true`, plus `JSEARCH_API_KEY`, `JSEARCH_MONTHLY_LIMIT`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` as needed.
5. Use **one instance** (rate limits and the job-search cache are kept in memory; SQLite is a single file).

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
- [ ] Back up the database file regularly (copy it while the app is stopped, or use your host's snapshots).

### Verify the deployed app

1. `https://your-app/healthz` returns `ok`.
2. Create an account, add an application, refresh, sign in from another browser — the data is there.
3. In a private window (signed out), Job Search asks you to sign in; signed in, a search returns listings.
4. **Settings → AI connection** shows Connected (if you set a key).
5. "Forgot password" sends an email (if Resend is configured).

---

## Security notes

- API keys live only on the server and are never sent to the browser.
- Passwords are hashed with scrypt and a random salt; sessions are random tokens stored hashed in the database, sent as `HttpOnly`, `SameSite=Lax` (and `Secure` in production) cookies.
- Every data request uses the user id from the session, so users can only read and write their own data.
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
