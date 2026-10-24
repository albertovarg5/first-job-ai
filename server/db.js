// SQLite database (Node's built-in node:sqlite, no extra install).
// The file location comes from DATABASE_PATH (default: data/first-job-ai.db).
// Migrations run automatically and only ever add tables/columns.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL,
     password_changed_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE password_resets (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL,
     used_at TEXT
   );
   CREATE TABLE user_data (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     revision INTEGER NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE api_usage (
     period TEXT NOT NULL,
     service TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (period, service)
   );`,
  // Plans and monthly AI usage per user (see server/plans.js). No payments
  // yet: every account is on the free plan until billing is added.
  `ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
   CREATE TABLE ai_usage (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     period TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, period)
   );`,
];

export async function openDatabase(path = 'data/first-job-ai.db') {
  const { DatabaseSync } = await import('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version += 1;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

// Usage counter for external APIs (e.g. JSearch monthly limit), stored in SQLite.
export function dbUsageStore(db) {
  const get = db.prepare('SELECT count FROM api_usage WHERE period = ? AND service = ?');
  const inc = db.prepare(
    'INSERT INTO api_usage (period, service, count) VALUES (?, ?, 1) ON CONFLICT(period, service) DO UPDATE SET count = count + 1',
  );
  return {
    count: (period, service) => get.get(period, service)?.count || 0,
    increment: (period, service) => inc.run(period, service),
  };
}
