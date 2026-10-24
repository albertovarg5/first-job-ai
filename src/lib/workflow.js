// The "find a job → get hired" workflow for one tracked application.
// Every step is worked out from data the user really has (the saved job
// description, letters, practice sessions, status), never assumed.

import { isSubmitted } from './applications.js';
import { analyzeJobMatch, findRequirements, findSkills } from './jobMatch.js';
import { isResumeEmpty } from './resume.js';

export const MIN_DESCRIPTION = 80;

export const hasDescription = (app) => String(app?.description || '').trim().length >= MIN_DESCRIPTION;

const workspaceLink = (app, hash) => `/tracker/${encodeURIComponent(app.id)}${hash ? `#${hash}` : ''}`;

// Returns the ordered steps for an application: { id, label, hint, done, to }.
export function applicationSteps(app, data = {}) {
  const id = encodeURIComponent(app.id);
  const letters = (data.coverLetters || []).filter((l) => l.applicationId === app.id);
  const sessions = (data.interviewSessions || []).filter((s) => s.applicationId === app.id);
  return [
    {
      id: 'details',
      label: 'Add the job description',
      hint: 'Paste the full posting so every other step can use it.',
      done: hasDescription(app),
      to: workspaceLink(app, 'details'),
    },
    {
      id: 'analyze',
      label: 'Analyze the requirements',
      hint: 'See what the job asks for and what your resume already shows.',
      done: Boolean(app.analysis),
      to: workspaceLink(app, 'analysis'),
    },
    {
      id: 'resume',
      label: 'Tailor your resume',
      hint: 'Compare your resume with this posting and fill the gaps you honestly can.',
      done: Boolean(app.tailoredAt),
      to: `/resume?tab=tailor&job=${id}`,
    },
    {
      id: 'letter',
      label: 'Write a cover letter',
      hint: 'A letter for this job, using only your real experience.',
      done: letters.length > 0,
      to: `/cover-letters?job=${id}`,
    },
    {
      id: 'apply',
      label: 'Apply and mark it as Applied',
      hint: 'Send the application, then update the status here.',
      done: isSubmitted(app),
      to: workspaceLink(app),
    },
    {
      id: 'interview',
      label: 'Practice the interview',
      hint: 'Answer questions for this role and get feedback.',
      done: sessions.length > 0,
      to: `/interview?job=${id}`,
    },
  ];
}

// The first unfinished step, or null when there is nothing left to do
// (every step done, or the application is closed).
export function nextStep(app, data) {
  if (app.status === 'rejected') return null;
  return applicationSteps(app, data).find((s) => !s.done) || null;
}

export function stepProgress(app, data) {
  const steps = applicationSteps(app, data);
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, percent: Math.round((done / steps.length) * 100) };
}

// Open applications that still have a next step, most recently updated first.
export function applicationsNeedingAction(data, limit = 3) {
  return (data.applications || [])
    .filter((a) => a.status !== 'offer' && a.status !== 'rejected')
    .map((app) => ({ app, step: nextStep(app, data), progress: stepProgress(app, data) }))
    .filter((x) => x.step)
    .sort((a, b) => String(b.app.updatedAt || '').localeCompare(String(a.app.updatedAt || '')))
    .slice(0, limit);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const strings = (list, max = 10) => (Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, max);

// Cleans an AI analysis. Evidence quotes are kept only when they really
// appear in the resume, so the app never claims experience the user didn't write.
export function verifyAnalysis(raw, resumeText) {
  const haystack = norm(resumeText);
  const reqs = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((r) => r && String(r.requirement || '').trim())
      .slice(0, 10)
      .map((r) => {
        const quote = norm(r.evidence);
        const shown = quote.length >= 8 && haystack.includes(quote);
        return { requirement: String(r.requirement).trim(), evidence: shown ? String(r.evidence).trim() : '', shown };
      });
  return {
    summary: String(raw?.summary || '').trim(),
    mustHave: reqs(raw?.mustHave),
    niceToHave: reqs(raw?.niceToHave),
    responsibilities: strings(raw?.responsibilities),
    keywords: strings(raw?.keywords, 15),
    questionsToAsk: strings(raw?.questionsToAsk, 3),
  };
}

// Keyword-based analysis used when AI is off or unavailable (Basic mode).
// Requirements are only marked "shown" when the skill name is on the resume;
// requirement lines (degree, years…) are left for the user to check.
export function basicAnalysis(resume, jobDescription) {
  const match = analyzeJobMatch(resume, jobDescription);
  const resumeEmpty = isResumeEmpty(resume);
  const skills = findSkills(jobDescription);
  return {
    summary: '',
    mustHave: [
      ...findRequirements(jobDescription).map((r) => ({ requirement: r.label, evidence: '', shown: false })),
      ...skills.map((s) => ({ requirement: s, evidence: '', shown: !resumeEmpty && match.matched.includes(s) })),
    ].slice(0, 10),
    niceToHave: [],
    responsibilities: [],
    keywords: skills.slice(0, 15),
    questionsToAsk: [],
  };
}
