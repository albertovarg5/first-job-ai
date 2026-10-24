// Consistent copies of the SQLite database (accounts, saved data, subscriptions).
//
// VACUUM INTO writes a complete, consistent copy even while the app is
// running, which a raw disk snapshot of a live database doesn't guarantee.
// Backups go to BACKUP_DIR (default: a "backups" folder next to the database)
// and only the newest BACKUP_KEEP files (default 14) are kept.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const NAME_RE = /^first-job-ai-\d{8}-\d{6}\.db$/;

export function backupSettings(env = {}) {
  const dbPath = resolve(env.DATABASE_PATH || 'data/first-job-ai.db');
  const keep = Number.parseInt(env.BACKUP_KEEP, 10);
  return {
    dbPath,
    dir: resolve(env.BACKUP_DIR || join(dirname(dbPath), 'backups')),
    keep: Number.isInteger(keep) && keep > 0 ? keep : 14,
  };
}

// Writes one backup with an already-open database and prunes old ones. Returns the new file's path.
export function backupDatabase(db, { dir, keep }, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(dir, `first-job-ai-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  const old = readdirSync(dir).filter((f) => NAME_RE.test(f)).sort().reverse().slice(keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return file;
}
