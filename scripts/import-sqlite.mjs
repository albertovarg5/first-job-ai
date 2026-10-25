// Copies the old SQLite database (or a backup snapshot) into PostgreSQL:
//   npm run db:import                         imports data/first-job-ai.db
//   npm run db:import -- path\to\file.db      imports another file
//
// Target: DATABASE_URL (from the environment or .env), or the local
// development database when it isn't set. The target must be empty.
// The SQLite file is never changed: a copy is saved to data/backups first and
// the import reads from that copy.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describeTarget, openDatabase } from '../server/db.js';
import { importSqlite } from '../server/importSqlite.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const file = resolve(process.argv[2] || 'data/first-job-ai.db');
const target = process.env.DATABASE_URL || 'data/pglite';
if (!existsSync(file)) {
  console.error(`No SQLite file at ${file}.`);
  process.exit(1);
}

// A consistent copy first (works while the old app is still running).
mkdirSync('data/backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const copy = resolve(join('data/backups', `before-postgres-import-${stamp}.db`));
const src = new DatabaseSync(file, { readOnly: true });
try {
  src.prepare('VACUUM INTO ?').run(copy);
} finally {
  src.close();
}
console.log(`Source:  ${file} (unchanged)`);
console.log(`Copy:    ${copy}`);
console.log(`Target:  ${describeTarget(target)}`);

const db = await openDatabase(target);
try {
  const counts = await importSqlite(copy, db);
  console.log('\nImported (rows per table, verified):');
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(18)} ${n}`);
  console.log('\nDone. Sign in to check your account, then keep the SQLite file and the copy as a backup.');
} catch (err) {
  console.error(`\nImport failed, nothing was written: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
