# First Job AI

**First Job AI helps people land their first job.** It's built for college students, recent graduates, internship seekers, career changers, and anyone with little work experience.

It turns everyday experience (class projects, volunteering, part-time jobs) into professional resume language, builds a clean PDF resume, tracks job applications, runs interview practice, and keeps the search moving with small daily missions.

Everything runs on your own computer. Your data is saved in your browser. AI is **optional**: every feature works without it in a clearly labeled **Basic mode**, and you can connect a real AI model with your own API key.

---

## Features

| Area | What you can do |
| --- | --- |
| **Landing page** | A live demo of the Experience Translator you can type into. |
| **Onboarding** | Three quick steps: who you are, your experience level, your goals and target job. |
| **Dashboard** | Personalized greeting, career progress milestones, applications submitted, upcoming interviews, resume completion, today's missions, quick actions and recent activity — all calculated from your own saved data. |
| **Resume Builder** | Contact, summary, education, experience, projects, volunteering, skills and achievements. "Improve wording" on any bullet list. Completeness score with a to-do list. Live preview. **Download as PDF.** |
| **Tailor to a job** | Paste a job description (or pick one saved in your tracker) to see matching skills, missing skills, qualifications to check, and suggestions. |
| **Job Tracker** | Add, edit and delete applications with company, title, location, link, description, date applied, interview date/time and notes. Six statuses: Interested, Applying, Applied, Interview, Offer, Rejected. Search, filter by status, sort, and switch between **List** and **Board** views. |
| **Interview Practice** | Choose a job title, interview type (General, Behavioral, Role-specific, Mixed) and number of questions. Write answers, get feedback, continue unfinished sessions, and review past answers. |
| **Experience Translator** | Describe what you did in plain words → editable professional bullets. Save to a library, copy, or add straight to your resume. |
| **Career Missions** | Three small tasks per day, chosen around what you still need to do. Track today's progress, your streak, total missions and the last 14 days. |
| **Settings** | Edit your profile, check/turn AI on or off, download a backup, restore a backup, or delete all data. |

### Honesty rules built into the app

- The tools **only rephrase what you write**. They never invent numbers, results, tools, duties or achievements.
- When something would make your resume stronger, the app **asks you a question** ("Do you know any real numbers?") instead of making something up.
- AI results are labeled **AI**. Without AI, features say **Basic mode — no AI**, and interview feedback says **Automated checklist — not AI**.

---

## Get it running (Windows + VS Code)

### 1. Install Node.js (one time)

1. Go to <https://nodejs.org> and download the **LTS** version (version 20.19 or newer; 22 or 24 is ideal).
2. Run the installer and keep the default options.
3. Restart VS Code if it was open.

To check it worked, open a terminal and type:

```bash
node -v
```

You should see something like `v22.x.x`.

### 2. Open the project

1. Unzip `first-job-ai.zip` somewhere easy, like `Documents\first-job-ai`.
2. In VS Code: **File → Open Folder…** and choose the `first-job-ai` folder (the one that contains `package.json`).
3. Open a terminal inside VS Code: **Terminal → New Terminal**.

### 3. Install and start

Type these two commands in the terminal, one at a time:

```bash
npm install
```

This downloads the libraries the app needs (React, React Router, Vite) into a `node_modules` folder. It takes a minute the first time. You only need to run it again if `package.json` changes.

```bash
npm run dev
```

This starts the app on your computer. Your browser should open automatically at **<http://localhost:5173>**. If it doesn't, hold **Ctrl** and click the link shown in the terminal.

**To stop the app:** click in the terminal and press **Ctrl + C**.

### Commands

| Command | What it does |
| --- | --- |
| `npm install` | Downloads the project's libraries. Run once, or after `package.json` changes. |
| `npm run dev` | Starts the app for development. Changes you save in VS Code appear instantly. |
| `npm test` | Runs the automated tests. |
| `npm run build` | Creates an optimized version of the site in a `dist` folder. |
| `npm run preview` | Serves that `dist` build locally (AI route included) so you can check it. |

---

## Connect real AI (optional)

Without a key, the app uses Basic mode. To turn on AI-powered translations, interview feedback and resume suggestions:

1. **Get an API key.** Create an account at <https://console.anthropic.com>, add billing (AI usage is paid per request, usually fractions of a cent each), and create an API key. It starts with `sk-ant-`.
2. **Create your `.env` file.** In VS Code's file list, right-click `.env.example` → **Copy**, then right-click the folder → **Paste**. Rename the copy to exactly `.env`.
3. **Paste your key** after `ANTHROPIC_API_KEY=` so the line looks like:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
   ```
   Save the file.
4. **Restart the app:** press **Ctrl + C** in the terminal, then run `npm run dev` again.
5. Open **Settings** in the app. The AI connection panel should say **Connected**. If the key is wrong, it tells you.

Optional: set `AI_MODEL=` in `.env` to choose a different model. Leave it blank to use the default.

### How your key stays safe

- The browser never sees your key. The page sends requests to `/api/ai/...` on your own computer, and a small server route (`server/aiHandler.js`, running inside Vite's local server) adds the key and calls the AI provider.
- Vite only sends variables that start with `VITE_` to the browser. **Never rename the key to start with `VITE_`.**
- `.env` is listed in `.gitignore`, so it won't be uploaded if you put the project on GitHub.
- When AI is on, the text you submit to an AI feature (your experience description, interview answer, or resume and job description) is sent to the AI provider to get a response. You can turn AI off in Settings at any time.

---

## Testing

### Automated tests

```bash
npm test
```

Runs 24 tests using Node's built-in test runner (nothing extra to install). They cover:

- the Experience Translator (including the example from the product brief, and checks that it never adds numbers or results),
- resume completeness and job-description matching,
- PDF generation (valid file, readable text, page breaks),
- daily missions and streaks,
- application search, filters, validation and upcoming interviews,
- interview question sets and the answer checklist,
- loading older saved data safely,
- the AI server route (no key → Basic mode; with a key → the key is used server-side and never returned).

### Manual check (5 minutes)

1. Open the app → **Get started** → complete onboarding.
2. **Resume Builder:** fill in Contact, add a job with a few plain-language lines, click **Improve wording**, add 5 skills. Watch the score reach 100%. Open **Preview** → **Download PDF**.
3. **Tailor to a job:** paste a real job posting and click **Compare**.
4. **Job Tracker:** add 2–3 applications, change a status from the dropdown, set an interview date, search, filter, switch to **Board**, delete one.
5. **Interview Practice:** start a 3-question session, answer, get feedback, finish, then open **History**.
6. **Experience Translator:** pick a type, click **Use an example**, **Translate**, edit a bullet, **Save to library**, **Add to resume**.
7. **Career Missions:** check off a mission.
8. **Refresh the page (F5).** Everything should still be there.
9. Make the browser window narrow (or press **F12** → device toolbar) to see the phone layout and menu.

---

## Folder structure

```
first-job-ai/
├── index.html                  Page shell Vite loads
├── package.json                Project info, scripts and libraries
├── vite.config.js              Vite setup + adds the local /api/ai route
├── .env.example                Template for your API key (copy to .env)
├── public/
│   └── favicon.svg
├── server/
│   └── aiHandler.js            Server-side AI route (holds the API key)
├── src/
│   ├── main.jsx                Starts React, the router and app state
│   ├── App.jsx                 All page routes
│   ├── pages/                  One file per page
│   │   ├── Landing.jsx
│   │   ├── Onboarding.jsx
│   │   ├── Dashboard.jsx
│   │   ├── ResumeBuilder.jsx
│   │   ├── JobTracker.jsx
│   │   ├── InterviewPractice.jsx
│   │   ├── ExperienceTranslator.jsx
│   │   ├── CareerMissions.jsx
│   │   ├── Settings.jsx
│   │   └── NotFound.jsx
│   ├── components/             Reusable pieces (sidebar, dialogs, forms…)
│   │   ├── AppLayout.jsx       Sidebar + mobile menu around app pages
│   │   ├── ui.jsx              Small building blocks: Field, EmptyState, ProgressRing…
│   │   ├── Modal.jsx           Dialog + confirm dialog
│   │   ├── Icon.jsx            Built-in icon set
│   │   ├── ApplicationForm.jsx
│   │   ├── AddToResumeDialog.jsx
│   │   ├── FeedbackView.jsx
│   │   ├── MissionItem.jsx
│   │   └── resume/             Resume sections, preview, tailoring, bullet editor
│   ├── context/
│   │   ├── AppDataContext.jsx  All saved data + actions (saves to localStorage)
│   │   └── ToastContext.jsx    Confirmation and error messages
│   ├── lib/                    Plain JavaScript logic (no React) — easy to test
│   │   ├── translator.js       Basic-mode experience rewriter
│   │   ├── jobMatch.js         Resume vs. job description comparison
│   │   ├── resume.js           Resume model and completeness score
│   │   ├── pdf.js              Small PDF writer (no library needed)
│   │   ├── resumePdf.js        Resume layout for the PDF
│   │   ├── applications.js     Statuses, filtering, validation
│   │   ├── questionBank.js     Interview question library
│   │   ├── answerChecklist.js  Basic-mode interview feedback
│   │   ├── missions.js         Daily missions and streaks
│   │   ├── ai.js / rewrite.js  Talking to the local AI route, with Basic-mode fallback
│   │   ├── storage.js          localStorage load/save
│   │   └── utils.js, profileOptions.js
│   └── styles/
│       ├── global.css          Design system: colors, type, buttons, forms, layout
│       └── pages.css           Page-specific styles
└── tests/                      Automated tests (npm test)
```

### Where your data lives

Everything is saved in your browser's **localStorage** under the key `first-job-ai:v1`. It survives page refreshes and restarts, but it is tied to this browser on this computer. Use **Settings → Download backup** to keep a copy or move to another computer.

---

## What's not included yet (ideas for next steps)

- **Accounts and cloud sync.** Data is per-browser. A backend (for example Supabase or Firebase) would let you log in from any device.
- **Hosting online with AI.** The AI route runs inside Vite's local server (`npm run dev` / `npm run preview`). To put the site online *with* AI, move `server/aiHandler.js` into a serverless function (Vercel, Netlify or Cloudflare) and set `ANTHROPIC_API_KEY` in that host's settings. The site itself works online without AI as-is.
- **AI-generated interview questions.** Questions come from a built-in library; only the feedback uses AI.
- **Multiple resumes or templates.** There is one resume with one clean, ATS-friendly layout.
- **Voice practice.** Interview answers are typed, not spoken.
- **Cover letters, reminders/notifications, job search integrations.**
- **Dark mode.**
- **Browser (end-to-end) tests in the repo.** The included tests cover the logic; the user interface was tested by clicking through it in a browser.

---

## Troubleshooting

**`npm` is not recognized** — Node.js isn't installed or VS Code was open during installation. Install Node.js, then fully close and reopen VS Code.

**"running scripts is disabled on this system" (PowerShell)** — Run this once in the VS Code terminal, then try again:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
Or switch the terminal to Command Prompt: click the **⌄** next to the **+** in the terminal panel → **Command Prompt**.

**Port 5173 is already in use** — Another copy is running. Close the other terminal, or use the new address Vite prints (for example `localhost:5174`).

**Settings says "Not connected" after adding a key** — Check that the file is named exactly `.env` (not `.env.txt`), the line has no spaces or quotes, and that you restarted `npm run dev`.

**My data disappeared** — Data is per browser. A different browser, a private window, or clearing site data starts fresh. Restore from a backup in Settings.
