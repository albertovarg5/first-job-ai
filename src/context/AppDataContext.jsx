import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadData, saveData, defaultData, normalizeData } from '../lib/storage.js';
import { createId, toDateKey } from '../lib/utils.js';
import { fetchAiStatus } from '../lib/ai.js';
import { addSavedJob, findApplicationForJob, jobToApplication, removeSavedJob } from '../lib/jobs.js';

const AppDataContext = createContext(null);

const MAX_ACTIVITY = 60;

export function AppDataProvider({ children }) {
  const [data, setData] = useState(loadData);
  // Latest data for actions that must return a result synchronously.
  const dataRef = useRef(data);
  dataRef.current = data;
  const [saveError, setSaveError] = useState(false);
  const [aiStatus, setAiStatus] = useState({ checked: false, connected: false, model: null });

  // Save on every change.
  useEffect(() => {
    setSaveError(!saveData(data));
  }, [data]);

  const refreshAiStatus = useCallback(async () => {
    const status = await fetchAiStatus();
    setAiStatus({ checked: true, ...status });
    return status;
  }, []);

  useEffect(() => {
    refreshAiStatus();
  }, [refreshAiStatus]);

  const update = useCallback((fn) => setData((prev) => fn(prev)), []);

  const logActivity = useCallback(
    (type, text) =>
      update((d) => ({
        ...d,
        activity: [{ id: createId('act'), type, text, at: new Date().toISOString() }, ...d.activity].slice(0, MAX_ACTIVITY),
      })),
    [update],
  );

  const actions = useMemo(
    () => ({
      // Profile & settings
      saveProfile(profile) {
        update((d) => {
          const resume = { ...d.resume };
          // Prefill resume contact name/email from onboarding if empty.
          if (!resume.contact.fullName && profile.name) resume.contact = { ...resume.contact, fullName: profile.name };
          if (!resume.contact.email && profile.email) resume.contact = { ...resume.contact, email: profile.email };
          return { ...d, resume, profile: { ...d.profile, ...profile, createdAt: d.profile?.createdAt || new Date().toISOString() } };
        });
      },
      updateSettings(patch) {
        update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
      },

      // Resume
      saveResume(resume) {
        update((d) => ({ ...d, resume: { ...resume, updatedAt: new Date().toISOString() } }));
      },

      // Applications
      addApplication(app) {
        const now = new Date().toISOString();
        const record = { ...app, id: createId('app'), createdAt: now, updatedAt: now };
        update((d) => ({ ...d, applications: [record, ...d.applications] }));
        return record;
      },
      updateApplication(id, patch) {
        update((d) => ({
          ...d,
          applications: d.applications.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a)),
        }));
      },
      deleteApplication(id) {
        update((d) => ({ ...d, applications: d.applications.filter((a) => a.id !== id) }));
      },

      // Saved jobs from Job Search (one copy per listing).
      saveJob(job) {
        update((d) => ({ ...d, savedJobs: addSavedJob(d.savedJobs, job) }));
      },
      unsaveJob(jobId) {
        update((d) => ({ ...d, savedJobs: removeSavedJob(d.savedJobs, jobId) }));
      },
      // Adds a search result to the tracker unless it's already there.
      // Returns { record, created }.
      trackJob(job) {
        const existing = findApplicationForJob(dataRef.current.applications, job);
        if (existing) return { record: existing, created: false };
        const now = new Date().toISOString();
        const record = { ...jobToApplication(job), id: createId('app'), createdAt: now, updatedAt: now };
        dataRef.current = { ...dataRef.current, applications: [record, ...dataRef.current.applications] };
        update((d) => (findApplicationForJob(d.applications, job) ? d : { ...d, applications: [record, ...d.applications] }));
        return { record, created: true };
      },

      // Cover letters
      saveCoverLetter(letter) {
        const now = new Date().toISOString();
        const record = { ...letter, id: letter.id || createId('cl'), createdAt: letter.createdAt || now, updatedAt: now };
        update((d) => {
          const exists = d.coverLetters.some((c) => c.id === record.id);
          return {
            ...d,
            coverLetters: exists ? d.coverLetters.map((c) => (c.id === record.id ? record : c)) : [record, ...d.coverLetters],
          };
        });
        return record;
      },
      deleteCoverLetter(id) {
        update((d) => ({ ...d, coverLetters: d.coverLetters.filter((c) => c.id !== id) }));
      },

      // Interview practice
      saveInterviewSession(session) {
        update((d) => {
          const exists = d.interviewSessions.some((s) => s.id === session.id);
          return {
            ...d,
            interviewSessions: exists
              ? d.interviewSessions.map((s) => (s.id === session.id ? session : s))
              : [session, ...d.interviewSessions],
          };
        });
      },
      deleteInterviewSession(id) {
        update((d) => ({ ...d, interviewSessions: d.interviewSessions.filter((s) => s.id !== id) }));
      },

      // Experience translator
      saveTranslation(entry) {
        const record = { ...entry, id: entry.id || createId('tr'), createdAt: entry.createdAt || new Date().toISOString() };
        update((d) => {
          const exists = d.translations.some((t) => t.id === record.id);
          return {
            ...d,
            translations: exists ? d.translations.map((t) => (t.id === record.id ? record : t)) : [record, ...d.translations],
          };
        });
        return record;
      },
      deleteTranslation(id) {
        update((d) => ({ ...d, translations: d.translations.filter((t) => t.id !== id) }));
      },

      // Missions
      setMissionDone(missionId, done, dateKey = toDateKey()) {
        update((d) => {
          const day = d.missions.completed[dateKey] || [];
          const without = day.filter((id) => id !== missionId);
          const next = done ? [...without, missionId] : without;
          const completed = { ...d.missions.completed, [dateKey]: next };
          if (!next.length) delete completed[dateKey];
          return { ...d, missions: { completed } };
        });
      },

      logActivity,

      // Data management
      importData(raw) {
        setData(normalizeData(raw));
      },
      resetAll() {
        setData(defaultData());
      },
    }),
    [update, logActivity],
  );

  const aiActive = aiStatus.connected && data.settings.aiEnabled;

  const value = useMemo(
    () => ({ data, actions, aiStatus, aiActive, refreshAiStatus, saveError }),
    [data, actions, aiStatus, aiActive, refreshAiStatus, saveError],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider');
  return ctx;
}
