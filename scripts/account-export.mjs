// Saves ONE account and the data it owns from the LOCAL development database
// (data/pglite) to a text file, to move it into production (see account-import.mjs):
//   npm run account:export -- you@example.com
// Always reads data/pglite, whatever DATABASE_URL says. Only reads, inside a
// READ ONLY transaction: nothing in the database changes (no migrations either).
//
// The file holds your password hash and saved data: keep it private and
// delete it after the import. It is never printed.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodeBundle, describeBundle, encodeBundle, exportAccount } from '../server/accountTransfer.js';
import { describeTarget, openDatabase } from '../server/db.js';

const source = 'data/pglite';
const email = String(process.argv[2] || '').trim();
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = resolve(process.argv[3] || `data/exports/account-${stamp}.txt`);
if (!email) {
  console.error('Usage: npm run account:export -- you@example.com');
  process.exit(1);
}
// Opening a missing folder would create a new, empty database.
if (!existsSync(source)) {
  console.error(`No local database at ${resolve(source)}. Run this in the project folder. Nothing was changed.`);
  process.exit(1);
}

console.log(`Source: ${describeTarget(source)}`);
let db;
try {
  db = await openDatabase(source, { migrate: false });
  await db.exec('BEGIN TRANSACTION READ ONLY');
  const bundle = await exportAccount(db, email);
  await db.exec('ROLLBACK');
  const text = encodeBundle(bundle);
  decodeBundle(text); // The file is checked exactly as the import will read it.
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, { mode: 0o600, flag: 'wx' }); // Never overwrites an existing file.
  for (const line of describeBundle(bundle)) console.log(line);
  console.log(`\nSaved: ${out} (${text.trim().split('\n').length} lines). Keep it private; delete it after the import.`);
} catch (err) {
  console.error(`Export failed: ${err.message} Nothing was changed.`);
  process.exitCode = 1;
} finally {
  await db?.close();
}
