import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadData, saveData, defaultData, normalizeData } from '../lib/storage.js';
import { createId, toDateKey } from '../lib/utils.js';
import { fetchAiStatus } from '../lib/ai.js';
import { apiFetch } from '../lib/api.js';
import { withStatusHistory } from '../lib/applications.js';
import { addSavedJob, findApplicationForJob, jobToApplication, removeSavedJob } from '../lib/jobs.js';
import { useAuth } from './AuthContext.jsx';

const AppDataContext = createContext(null);

const MAX_ACTIVITY = 60;
const SYNC_DELAY_MS = 700;

// Guest mode saves to this browser's localStorage. When signed in, data is
// loaded from and saved to the user's account on the server instead.
export function AppDataProvider({ children }) {
  const auth = useAuth();
  const mode = auth.status !== 'ready' ? 'loading' : auth.user ? 'account' : 'guest';
  const userId = auth.user?.id || null;

  const [data, setData] = useState(loadData);
  // Latest data for actions that must return a result synchronously.
  const dataRef = useRef(data);
  dataRef.current = data;
  const [saveError, setSaveError] = useState(false);
  const [aiStatus, setAiStatus] = useState({ checked: false, connected: false, model: null });
  // sync.state: 'idle' | 'loading' | 'loadError' | 'saving' | 'saved' | 'error' | 'conflict'
  const [sync, setSync] = useState({ state: 'idle' });

  // Whose data is in memory: 'guest', a user id, or null while loading.
  const ownerRef = useRef(null);
  const [owner, setOwnerState] = useState(null);
  const setOwner = useCallback((value) => {
    ownerRef.current = value;
    setOwnerState(value);
  }, []);
  const skipSaveRef = useRef(true);
  const revisionRef = useRef(0);
  const timerRef = useRef(null);
  const inflightRef = useRef(false);
  const pendingRef = useRef(false);
  const signedOutRef = useRef(auth.signedOut);
  signedOutRef.current = auth.signedOut;

  const loadAccount = useCallback(async (id) => {
    setOwner(null);
    setSync({ state: 'loading' });
    try {
      const res = await apiFetch('/api/data');
      revisionRef.current = res.revision;
      skipSaveRef.current = true;
      setOwner(id);
      setData(normalizeData(res.data));
      setSync({ state: 'saved', at: res.updatedAt });
    } catch (err) {
      if (err.code === 'auth_required') signedOutRef.current();
      setSync({ state: 'loadError', message: err.message });
    }
  }, [setOwner]);

  // Switch data when the user signs in or out.
  useEffect(() => {
    if (mode === 'loading') return undefined;
    clearTimeout(timerRef.current);
    if (mode === 'guest') {
      skipSaveRef.current = true;
      setOwner('guest');
      setData(loadData());
      setSync({ state: 'idle' });
      return undefined;
    }
    loadAccount(userId);
    return () => clearTimeout(timerRef.current);
  }, [mode, userId, loadAccount, setOwner]);

  const push = useCallback(async () => {
    const owner = ownerRef.current;
    if (!owner || owner === 'guest') return;
    if (inflightRef.current) {
      pendingRef.current = true;
      return;
    }
    inflightRef.current = true;
    setSync({ state: 'saving' });
    try {
      const res = await apiFetch('/api/data', { method: 'PUT', body: { data: dataRef.current, baseRevision: revisionRef.current } });
      if (ownerRef.current === owner) {
        revisionRef.current = res.revision;
        setSync({ state: 'saved', at: res.updatedAt });
      }
    } catch (err) {
      pendingRef.current = false;
      if (err.code === 'conflict') setSync({ state: 'conflict', serverRevision: err.data?.revision });
      else if (err.code === 'auth_required') {
        setSync({ state: 'error', message: 'You were signed out. Sign in again to keep saving.' });
        signedOutRef.current();
      } else setSync({ state: 'error', message: err.message });
    } finally {
      inflightRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        push();
      }
    }
  }, []);

  // Save on every change.
  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (ownerRef.current === 'guest') {
      setSaveError(!saveData(data));
    } else if (ownerRef.current) {
      clearTimeout(timerRef.current);
      setSync((s) => (s.state === 'conflict' ? s : { state: 'saving' }));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        push();
      }, SYNC_DELAY_MS);
    }
  }, [data, push]);

  // Warn before closing the tab while changes are still being saved.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (ownerRef.current && ownerRef.current !== 'guest' && (timerRef.current || inflightRef.current) && sync.state !== 'saved') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [sync.state]);

  const syncActions = useMemo(
    () => ({
      retry: push,
      // Conflict: keep this tab's version and overwrite the server copy.
      keepMine(serverRevision) {
        revisionRef.current = serverRevision ?? revisionRef.current;
        push();
      },
      // Conflict: throw away this tab's unsaved changes and reload.
      loadLatest() {
        if (userId) loadAccount(userId);
      },
    }),
    [push, loadAccount, userId],
  );

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
        const record = { ...app, id: createId('app'), createdAt: now, updatedAt: now, statusHistory: withStatusHistory({}, app.status || 'interested', now) };
        update((d) => ({ ...d, applications: [record, ...d.applications] }));
        return record;
      },
      updateApplication(id, patch) {
        update((d) => ({
          ...d,
          applications: d.applications.map((a) => {
            if (a.id !== id) return a;
            const now = new Date().toISOString();
            const next = { ...a, ...patch, updatedAt: now };
            if (patch.status && patch.status !== a.status) next.statusHistory = withStatusHistory(a, patch.status, now);
            return next;
          }),
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
        const record = { ...jobToApplication(job), id: createId('app'), createdAt: now, updatedAt: now, statusHistory: withStatusHistory({}, 'interested', now) };
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
      // Signed in: copy the guest data saved in this browser into the account.
      importGuestData() {
        setData(loadData());
      },
      resetAll() {
        setData(defaultData());
      },
    }),
    [update, logActivity],
  );

  // On a public server, guests can't use the paid AI key (see API_REQUIRE_AUTH).
  const aiLocked = auth.requireAuthForApis && !auth.user;
  const aiActive = aiStatus.connected && data.settings.aiEnabled && !aiLocked;

  // True once the data in memory belongs to the current user (or guest).
  const dataReady = mode !== 'loading' && owner === (mode === 'guest' ? 'guest' : userId);

  const value = useMemo(
    () => ({ data, actions, aiStatus, aiActive, aiLocked, refreshAiStatus, saveError, mode, dataReady, sync, syncActions }),
    [data, actions, aiStatus, aiActive, aiLocked, refreshAiStatus, saveError, mode, dataReady, sync, syncActions],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider');
  return ctx;
}
