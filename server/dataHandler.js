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
import { HttpError, pathOf, readJson, send } from './http.js';

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
  const get = db.prepare('SELECT data, revision, updated_at FROM user_data WHERE user_id = ?');
  const insert = db.prepare('INSERT INTO user_data (user_id, data, revision, updated_at) VALUES (?, ?, 1, ?)');
  const update = db.prepare('UPDATE user_data SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?');

  return async function dataHandler(req, res, next) {
    const path = pathOf(req);
    if (path !== '/') return typeof next === 'function' ? next() : send(res, 404, { error: 'Not found' });
    try {
      const user = requireUser(req);
      if (req.method === 'GET') {
        const row = get.get(user.id);
        return send(res, 200, row ? { data: JSON.parse(row.data), revision: row.revision, updatedAt: row.updated_at } : { data: null, revision: 0, updatedAt: null });
      }
      if (req.method === 'PUT') {
        const body = await readJson(req, MAX_DATA_BYTES);
        const baseRevision = Number(body.baseRevision);
        if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new HttpError(400, 'Missing baseRevision.', 'invalid_input');
        const json = JSON.stringify(sanitizeUserData(body.data));
        const now = new Date().toISOString();
        const current = get.get(user.id);
        let ok;
        if (!current) {
          try {
            ok = baseRevision === 0 && insert.run(user.id, json, now).changes === 1;
          } catch {
            ok = false; // Another request created the row first.
          }
        } else ok = update.run(json, now, user.id, baseRevision).changes === 1;
        if (!ok) {
          const latest = get.get(user.id);
          return send(res, 409, {
            error: 'Your data was changed on another device or tab.',
            code: 'conflict',
            revision: latest?.revision ?? 0,
          });
        }
        const saved = get.get(user.id);
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
