// Copies a SQLite database (the app's earlier database, or a backup snapshot
// from server/backup.js) into PostgreSQL. Used by `npm run db:import`.
//
// - The SQLite file is opened read-only and never changed.
// - Only an empty target is accepted, so nothing is overwritten or mixed.
// - Everything is copied in one transaction: either all rows arrive, or none.
// - Columns are matched by name; columns an older file doesn't have keep
//   their defaults (e.g. livemode = 0, test mode, for billing rows).
// - Row counts are compared before the transaction commits.
import { DatabaseSync } from 'node:sqlite';
import { TABLES } from './db.js';
import { columnsOf } from './backup.js';

const quote = (name) => `"${name.replace(/"/g, '""')}"`;

// Returns { table: rowCount }. Throws (and changes nothing) on any problem.
export async function importSqlite(file, db) {
  const src = new DatabaseSync(file, { readOnly: true });
  try {
    const existing = (await db.one('SELECT COUNT(*)::int AS n FROM users')).n;
    if (existing > 0) throw new Error(`The target database already has ${existing} account(s). Import only into an empty database.`);
    const present = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    if (!present.has('users')) throw new Error(`${file} has no users table. Is it a First Job AI database?`);

    const counts = {};
    await db.tx(async (t) => {
      for (const table of TABLES) {
        if (!present.has(table)) {
          counts[table] = 0;
          continue;
        }
        const sourceCols = new Set(src.prepare(`PRAGMA table_info(${quote(table)})`).all().map((r) => r.name));
        const cols = (await columnsOf(t, table)).filter((c) => sourceCols.has(c));
        const rows = src.prepare(`SELECT ${cols.map(quote).join(', ')} FROM ${quote(table)}`).all();
        const sql = `INSERT INTO ${quote(table)} (${cols.map(quote).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`;
        for (const row of rows) await t.run(sql, cols.map((c) => row[c]));
        counts[table] = rows.length;
      }
      for (const table of TABLES) {
        const n = (await t.one(`SELECT COUNT(*)::int AS n FROM ${quote(table)}`)).n;
        if (n !== counts[table]) throw new Error(`${table}: copied ${counts[table]} rows but found ${n}. Nothing was imported.`);
      }
    });
    return counts;
  } finally {
    src.close();
  }
}
