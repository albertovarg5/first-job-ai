import { linesOf } from './utils.js';

export function emptyResume() {
  return {
    contact: { fullName: '', email: '', phone: '', location: '', linkedin: '', website: '' },
    summary: '',
    education: [],
    experience: [],
    projects: [],
    volunteering: [],
    skills: [],
    achievements: [],
    updatedAt: null,
  };
}

export const SECTION_TEMPLATES = {
  education: { school: '', degree: '', field: '', start: '', end: '', details: '' },
  experience: { role: '', org: '', location: '', start: '', end: '', bullets: '' },
  projects: { name: '', role: '', start: '', end: '', link: '', bullets: '' },
  volunteering: { role: '', org: '', location: '', start: '', end: '', bullets: '' },
  achievements: { title: '', date: '', description: '' },
};

export function dateRange(start, end) {
  if (start && end) return `${start} – ${end}`;
  return start || end || '';
}

// Checklist used for the completeness score. Weights add up to 100.
export function resumeChecklist(resume) {
  const r = resume || emptyResume();
  const c = r.contact || {};
  const hasBullets = (items) => items.some((i) => linesOf(i.bullets).length > 0);
  const experienceLike = [...(r.experience || []), ...(r.projects || []), ...(r.volunteering || [])];
  return [
    { id: 'name', label: 'Add your full name', done: Boolean(c.fullName?.trim()), weight: 10, section: 'contact' },
    {
      id: 'contact',
      label: 'Add an email and phone or location',
      done: Boolean(c.email?.trim() && (c.phone?.trim() || c.location?.trim())),
      weight: 10,
      section: 'contact',
    },
    { id: 'summary', label: 'Write a short summary (2–3 sentences)', done: (r.summary || '').trim().length >= 40, weight: 15, section: 'summary' },
    { id: 'education', label: 'Add your education', done: (r.education || []).some((e) => e.school?.trim()), weight: 15, section: 'education' },
    {
      id: 'experience',
      label: 'Add a job, project or volunteer role',
      done: experienceLike.some((e) => (e.role || e.name || '').trim()),
      weight: 20,
      section: 'experience',
    },
    { id: 'bullets', label: 'Describe what you did with bullet points', done: hasBullets(experienceLike), weight: 15, section: 'experience' },
    { id: 'skills', label: 'List at least 5 skills', done: (r.skills || []).length >= 5, weight: 15, section: 'skills' },
  ];
}

export function resumeCompleteness(resume) {
  return resumeChecklist(resume).reduce((sum, item) => sum + (item.done ? item.weight : 0), 0);
}

// Plain text version used for job matching and AI prompts. AI prompts pass
// { includeContact: false } so names, emails and phone numbers are not sent.
export function resumeToText(resume, { includeContact = true } = {}) {
  const r = resume || emptyResume();
  const parts = [includeContact ? r.contact?.fullName : '', r.summary];
  for (const e of r.education || []) parts.push(e.school, e.degree, e.field, e.details);
  for (const key of ['experience', 'volunteering']) {
    for (const e of r[key] || []) parts.push(e.role, e.org, e.bullets);
  }
  for (const p of r.projects || []) parts.push(p.name, p.role, p.bullets);
  parts.push((r.skills || []).join(', '));
  for (const a of r.achievements || []) parts.push(a.title, a.description);
  return parts.filter(Boolean).join('\n');
}

export function isResumeEmpty(resume) {
  return resumeCompleteness(resume) === 0 && !(resume?.skills || []).length;
}
