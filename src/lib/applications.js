import { daysUntil, toDateKey } from './utils.js';

export const STATUSES = [
  { value: 'interested', label: 'Interested' },
  { value: 'applying', label: 'Applying' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
];

export const statusLabel = (value) => STATUSES.find((s) => s.value === value)?.label || value;

// Statuses that mean the application was actually sent.
const SUBMITTED = new Set(['applied', 'interview', 'offer', 'rejected']);
export const isSubmitted = (app) => SUBMITTED.has(app.status);

export function emptyApplication() {
  return {
    company: '',
    title: '',
    location: '',
    link: '',
    status: 'interested',
    dateApplied: '',
    interviewDate: '',
    description: '',
    notes: '',
  };
}

// interviewDate is stored as "YYYY-MM-DDTHH:mm" (datetime-local input).
export function upcomingInterviews(applications, today = new Date()) {
  return applications
    .filter((a) => a.interviewDate && a.status !== 'rejected')
    .map((a) => ({ ...a, inDays: daysUntil(a.interviewDate.slice(0, 10), today) }))
    .filter((a) => a.inDays !== null && a.inDays >= 0)
    .sort((a, b) => a.interviewDate.localeCompare(b.interviewDate));
}

export function countByStatus(applications) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s.value, 0]));
  for (const a of applications) counts[a.status] = (counts[a.status] || 0) + 1;
  return counts;
}

export function filterApplications(applications, { query = '', status = 'all', sort = 'updated' } = {}) {
  const q = query.trim().toLowerCase();
  const list = applications.filter((a) => {
    if (status !== 'all' && a.status !== status) return false;
    if (!q) return true;
    return [a.company, a.title, a.location, a.notes, a.description].some((v) => (v || '').toLowerCase().includes(q));
  });
  const sorters = {
    updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    company: (a, b) => (a.company || '').localeCompare(b.company || ''),
    applied: (a, b) => (b.dateApplied || '').localeCompare(a.dateApplied || ''),
    interview: (a, b) => (a.interviewDate || '9999').localeCompare(b.interviewDate || '9999'),
  };
  return [...list].sort(sorters[sort] || sorters.updated);
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Another tracked application for the same job (company + title + location).
export function findDuplicateApplication(app, applications = []) {
  return (
    applications.find(
      (other) => other.id !== app.id && same(other.company, app.company) && same(other.title, app.title) && same(other.location, app.location),
    ) || null
  );
}

// Appends a status change to the application's history.
export function withStatusHistory(app, status, at = new Date().toISOString()) {
  const history = Array.isArray(app.statusHistory) ? app.statusHistory : [];
  if (history.length && history[history.length - 1].status === status) return history;
  return [...history, { status, at }].slice(-50);
}

export function validateApplication(app, applications = []) {
  const errors = {};
  if (!app.company?.trim()) errors.company = 'Enter the company name.';
  if (!app.title?.trim()) errors.title = 'Enter the job title.';
  if (app.link) {
    try {
      const u = new URL(app.link);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      errors.link = 'Enter a full link starting with https://';
    }
  }
  if (app.dateApplied && app.dateApplied > toDateKey()) errors.dateApplied = 'The application date can’t be in the future.';
  if (!errors.company && !errors.title && findDuplicateApplication(app, applications)) {
    errors.title = 'This job (same company, title and location) is already in your tracker. Edit that entry instead.';
  }
  if ((app.notes || '').length > 5000) errors.notes = 'Notes can be up to 5,000 characters.';
  return errors;
}
