import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadData, saveData, defaultData, normalizeData } from '../lib/storage.js';
import { createId, toDateKey } from '../lib/utils.js';
import { fetchAiStatus } from '../lib/ai.js';

const AppDataContext = createContext(null);

const MAX_ACTIVITY = 60;

export function AppDataProvider({ children }) {
  const [data, setData] = useState(loadData);
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
