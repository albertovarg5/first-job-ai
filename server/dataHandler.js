// Stores each signed-in user's app data (profile, resume, applications, saved
// jobs, letters, practice…) as one JSON document. A user can only ever read or
// write their own row: the user id always comes from the session, never from
// the request.
//
// Routes (mounted at /api/data):
//   GET /  -> { data | null, revision, updatedAt }
//   PUT /  { data, baseRevision } -> { revision, updatedAt }
//          409 { code: 'conflict', revision } if another device saved first.

import { normalizeData } from '../src/lib/storage.js';
import { HttpError, createLimits, pathOf, rateLimited, readJson, send } from './http.js';

export const MAX_DATA_BYTES = 5 * 1024 * 1024;

const LIMITS = { applications: 2000, savedJobs: 1000, coverLetters: 500, interviewSessions: 500, translations: 1000, activity: 60 };

// Normalizes untrusted input into the app's data shape and enforces limits.
export function sanitizeUserData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Saved data must be an object.', 'invalid_data');
  const data = normalizeData(raw);
  for (const [key, max] of Object.entries(LIMITS)) {
    if (data[key].length > max) throw new HttpError(413, `Too many items in ${key} (limit ${max}).`, 'too_large');
    data[key] = data[key].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  }
  if (data.profile !== null && (typeof data.profile !== 'object' || Array.isArray(data.profile))) data.profile = null;
  // Applications must have unique ids.
  const seen = new Set();
  data.applications = data.applications.filter((a) => typeof a.id === 'string' && !seen.has(a.id) && seen.add(a.id));
  return data;
}

export function createDataHandler({ db, requireUser }) {
  const get = (userId) => db.one('SELECT data, revision, updated_at FROM user_data WHERE user_id = $1', [userId]);
  // ON CONFLICT DO NOTHING: if another request created the row first, nothing is inserted (a conflict).
  const insert = (...p) => db.run('INSERT INTO user_data (user_id, data, revision, updated_at) VALUES ($1, $2, 1, $3) ON CONFLICT DO NOTHING', p);
  const update = (...p) => db.run('UPDATE user_data SET data = $1, revision = revision + 1, updated_at = $2 WHERE user_id = $3 AND revision = $4', p);
  // The app saves a moment after each edit; this only stops scripted floods of up-to-5 MB writes.
  const limits = createLimits(db);

  return async function dataHandler(req, res, next) {
    const path = pathOf(req);
    if (path !== '/') return typeof next === 'function' ? next() : send(res, 404, { error: 'Not found' });
    try {
      const user = await requireUser(req);
      if (req.method === 'GET') {
        const row = await get(user.id);
        return send(res, 200, row ? { data: JSON.parse(row.data), revision: row.revision, updatedAt: row.updated_at } : { data: null, revision: 0, updatedAt: null });
      }
      if (req.method === 'PUT') {
        const r = await limits.take(`save:${user.id}`, { limit: 300, windowMs: 10 * 60 * 1000 });
        if (!r.ok) return rateLimited(res, r.retryAfter, 'Too many saves in a short time. Please wait a minute; your next change will be saved.');
        const body = await readJson(req, MAX_DATA_BYTES);
        const baseRevision = Number(body.baseRevision);
        if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new HttpError(400, 'Missing baseRevision.', 'invalid_input');
        const json = JSON.stringify(sanitizeUserData(body.data));
        const now = new Date().toISOString();
        const current = await get(user.id);
        let ok;
        if (!current) ok = baseRevision === 0 && (await insert(user.id, json, now)) === 1;
        else ok = (await update(json, now, user.id, baseRevision)) === 1;
        if (!ok) {
          const latest = await get(user.id);
          return send(res, 409, {
            error: 'Your data was changed on another device or tab.',
            code: 'conflict',
            revision: latest?.revision ?? 0,
          });
        }
        const saved = await get(user.id);
        return send(res, 200, { revision: saved.revision, updatedAt: saved.updated_at });
      }
      return send(res, 405, { error: 'Method not allowed' });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      console.error(err);
      return send(res, 500, { error: 'Could not save your data. Please try again.', code: 'server_error' });
    }
  };
}
