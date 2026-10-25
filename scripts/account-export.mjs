// Saves ONE account and the data it owns to a text file, to move it into
// another database (see account-import.mjs):
//   npm run account:export -- you@example.com
// Reads DATABASE_URL, or the local development database when it isn't set.
// Only reads: nothing in the database changes (no migrations either).
//
// The file holds your password hash and saved data: keep it private and
// delete it after the import. It is never printed.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodeBundle, describeBundle, encodeBundle, exportAccount } from '../server/accountTransfer.js';
import { describeTarget, maskSecrets, openDatabase } from '../server/db.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const target = String(process.env.DATABASE_URL || '').trim() || 'data/pglite';
const email = String(process.argv[2] || '').trim();
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = resolve(process.argv[3] || `data/exports/account-${stamp}.txt`);
if (!email) {
  console.error('Usage: npm run account:export -- you@example.com');
  process.exit(1);
}

console.log(`Source: ${describeTarget(target)}`);
let db;
try {
  db = await openDatabase(target, { migrate: false });
  const text = encodeBundle(await exportAccount(db, email));
  const bundle = decodeBundle(text); // The file is checked exactly as the import will read it.
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, { mode: 0o600, flag: 'wx' }); // Never overwrites an existing file.
  for (const line of describeBundle(bundle)) console.log(line);
  console.log(`\nSaved: ${out} (${text.trim().split('\n').length} lines). Keep it private; delete it after the import.`);
} catch (err) {
  console.error(`Export failed: ${maskSecrets(err.message, target)} Nothing was changed.`);
  process.exitCode = 1;
} finally {
  await db?.close();
}
