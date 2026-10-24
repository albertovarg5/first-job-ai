// Job search helpers used by the Job Search page and Career Assistant.
// Searches go to /api/jobs on our own server, which holds the JSearch key.
import { emptyApplication } from './applications.js';
import { apiFetch } from './api.js';

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'FULLTIME', label: 'Full-time' },
  { value: 'PARTTIME', label: 'Part-time' },
  { value: 'INTERN', label: 'Internship' },
  { value: 'CONTRACTOR', label: 'Contract' },
];

export const DATE_POSTED_OPTIONS = [
  { value: 'all', label: 'Any time' },
  { value: 'month', label: 'Past month' },
  { value: 'week', label: 'Past week' },
  { value: '3days', label: 'Past 3 days' },
  { value: 'today', label: 'Today' },
];

export const EXPERIENCE_OPTIONS = [
  { value: '', label: 'Any experience' },
  { value: 'no_experience', label: 'No experience required' },
  { value: 'under_3_years_experience', label: 'Under 3 years' },
  { value: 'more_than_3_years_experience', label: 'More than 3 years' },
  { value: 'no_degree', label: 'No degree required' },
];

export const COUNTRY_OPTIONS = [
  ['us', 'United States'], ['ca', 'Canada'], ['gb', 'United Kingdom'], ['ie', 'Ireland'], ['au', 'Australia'],
  ['nz', 'New Zealand'], ['in', 'India'], ['sg', 'Singapore'], ['de', 'Germany'], ['fr', 'France'], ['es', 'Spain'],
  ['it', 'Italy'], ['nl', 'Netherlands'], ['mx', 'Mexico'], ['br', 'Brazil'], ['za', 'South Africa'],
].map(([value, label]) => ({ value, label }));

export const employmentTypeLabel = (t) => EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === t)?.label || t;

export function emptySearch(profile = {}) {
  return {
    query: profile?.targetRole || '',
    location: profile?.location || '',
    country: '',
    remote: false,
    employmentTypes: [],
    datePosted: 'all',
    experience: '',
  };
}

export function validateSearch(s) {
  const errors = {};
  const q = String(s.query || '').trim();
  if (q.length < 2) errors.query = 'Enter a job title or keywords (at least 2 characters).';
  else if (q.length > 200) errors.query = 'Keep keywords under 200 characters.';
  if (String(s.location || '').trim().length > 100) errors.location = 'Keep the location under 100 characters.';
  return errors;
}

export function searchToParams(s, page = 1, cursor = '') {
  const p = new URLSearchParams();
  p.set('query', String(s.query || '').trim());
  if (s.location?.trim()) p.set('location', s.location.trim());
  if (s.country) p.set('country', s.country);
  if (s.remote) p.set('remote', 'true');
  if (s.employmentTypes?.length) p.set('employmentTypes', s.employmentTypes.join(','));
  if (s.datePosted && s.datePosted !== 'all') p.set('datePosted', s.datePosted);
  if (s.experience) p.set('experience', s.experience);
  p.set('page', String(page));
  // OpenWeb Ninja pages with a cursor returned by the previous response.
  if (page > 1 && cursor) p.set('cursor', cursor);
  return p;
}

export async function searchJobs(search, page = 1, cursor = '') {
  return apiFetch(`/api/jobs/search?${searchToParams(search, page, cursor)}`, {
    networkError: 'Could not reach the app server. Make sure it is running.',
  });
}

export async function fetchJobsStatus() {
  try {
    return await apiFetch('/api/jobs/status');
  } catch {
    return { configured: false, unreachable: true };
  }
}

const money = (n, currency) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString()}${currency ? ` ${currency}` : ''}`;
  }
};

const PERIOD = { HOUR: '/hour', DAY: '/day', WEEK: '/week', MONTH: '/month', YEAR: '/year' };

// Returns "" when the listing has no salary information.
export function formatSalary(salary) {
  if (!salary) return '';
  if (salary.text) return salary.text;
  const { min, max, currency, period } = salary;
  const per = PERIOD[String(period || '').toUpperCase()] || '';
  if (min && max && min !== max) return `${money(min, currency)} – ${money(max, currency)}${per}`;
  if (min || max) return `${money(min || max, currency)}${per}`;
  return '';
}

export function jobLocation(job) {
  if (job.isRemote && job.location) return `${job.location} (remote)`;
  if (job.isRemote) return 'Remote';
  return job.location || 'Location not listed';
}

// What the listing says about experience. Only reports what the source says.
export function experienceNote(job) {
  if (job.experience?.noExperienceRequired) return 'Listing says no experience required';
  if (job.experience?.months) {
    const years = job.experience.months / 12;
    return `Listing asks for about ${years >= 1 ? `${Math.round(years * 10) / 10} year${years === 1 ? '' : 's'}` : `${job.experience.months} months`} of experience`;
  }
  return '';
}

// Saved jobs: one entry per JSearch job id, newest first.
export function addSavedJob(savedJobs, job, now = new Date().toISOString()) {
  if (!job?.id || savedJobs.some((s) => s.id === job.id)) return savedJobs;
  return [{ id: job.id, savedAt: now, job }, ...savedJobs];
}

export function removeSavedJob(savedJobs, jobId) {
  return savedJobs.filter((s) => s.id !== jobId);
}

export function findApplicationForJob(applications, job) {
  if (!job) return null;
  return (
    applications.find((a) => a.sourceJobId && a.sourceJobId === job.id) ||
    applications.find(
      (a) =>
        job.applyLink &&
        a.link === job.applyLink &&
        a.title?.trim().toLowerCase() === job.title.trim().toLowerCase(),
    ) ||
    null
  );
}

export function jobToApplication(job) {
  return {
    ...emptyApplication(),
    company: job.employer,
    title: job.title,
    location: jobLocation(job),
    link: job.applyLink || '',
    description: job.description || '',
    status: 'interested',
    sourceJobId: job.id,
    source: 'jsearch',
  };
}
