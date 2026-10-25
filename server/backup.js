// Snapshots of the database (accounts, saved data, subscriptions) as SQLite files.
//
// All tables are read in one read-only transaction, so the copy is consistent
// even while the app is running. A snapshot is restored with
// `npm run db:import -- <file>` (see server/importSqlite.js). Backups go to
// BACKUP_DIR (default data/backups) and only the newest BACKUP_KEEP files
// (default 14) are kept.
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TABLES } from './db.js';

const NAME_RE = /^first-job-ai-\d{8}-\d{6}\.db$/;
const quote = (name) => `"${name.replace(/"/g, '""')}"`;

export function backupSettings(env = {}) {
  const keep = Number.parseInt(env.BACKUP_KEEP, 10);
  return {
    dir: resolve(env.BACKUP_DIR || 'data/backups'),
    keep: Number.isInteger(keep) && keep > 0 ? keep : 14,
  };
}

export const columnsOf = async (db, table) =>
  (await db.all('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position', [table])).map(
    (r) => r.column_name,
  );

// Writes one snapshot and prunes old ones. Returns the new file's path.
// shortcut: loads one table at a time into memory, fine for thousands of users; stream with a cursor beyond that.
export async function backupDatabase(db, { dir, keep }, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(dir, `first-job-ai-${stamp}.db`);
  const part = `${file}.part`;
  rmSync(part, { force: true });
  const out = new DatabaseSync(part);
  try {
    await db.tx(async (t) => {
      await t.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const version = (await t.one('SELECT version FROM schema_version'))?.version ?? 0;
      out.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
      out.prepare('INSERT INTO schema_version VALUES (?)').run(version);
      for (const table of TABLES) {
        const cols = await columnsOf(t, table);
        const rows = await t.all(`SELECT * FROM ${quote(table)}`);
        out.exec(`CREATE TABLE ${quote(table)} (${cols.map(quote).join(', ')})`);
        const insert = out.prepare(`INSERT INTO ${quote(table)} VALUES (${cols.map(() => '?').join(', ')})`);
        out.exec('BEGIN');
        for (const row of rows) insert.run(...cols.map((c) => row[c]));
        out.exec('COMMIT');
      }
    });
  } finally {
    out.close();
  }
  renameSync(part, file);
  const old = readdirSync(dir).filter((f) => NAME_RE.test(f)).sort().reverse().slice(keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return file;
}
