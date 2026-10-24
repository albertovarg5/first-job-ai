// Everything the app saves lives under one localStorage key.
import { emptyResume } from './resume.js';

export const STORAGE_KEY = 'first-job-ai:v1';

export function defaultData() {
  return {
    version: 1,
    profile: null,
    resume: emptyResume(),
    applications: [],
    savedJobs: [],
    coverLetters: [],
    interviewSessions: [],
    translations: [],
    missions: { completed: {} },
    activity: [],
    settings: { aiEnabled: true },
  };
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

// Merge saved data over defaults so older or partial saves still load.
export function normalizeData(raw) {
  const base = defaultData();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    resume: { ...base.resume, ...(raw.resume || {}), contact: { ...base.resume.contact, ...(raw.resume?.contact || {}) } },
    missions: { completed: { ...(raw.missions?.completed || {}) } },
    settings: { ...base.settings, ...(raw.settings || {}) },
    applications: Array.isArray(raw.applications) ? raw.applications : [],
    savedJobs: dedupeById(Array.isArray(raw.savedJobs) ? raw.savedJobs.filter((s) => s && s.id && s.job) : []),
    coverLetters: Array.isArray(raw.coverLetters) ? raw.coverLetters : [],
    interviewSessions: Array.isArray(raw.interviewSessions) ? raw.interviewSessions : [],
    translations: Array.isArray(raw.translations) ? raw.translations : [],
    activity: Array.isArray(raw.activity) ? raw.activity : [],
  };
}

export function loadData() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeData(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultData();
  }
}

export function saveData(data) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
