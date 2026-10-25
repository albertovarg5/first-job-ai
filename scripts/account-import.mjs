// Imports ONE account file made by `npm run account:export` into DATABASE_URL:
//   npm run account:import -- /tmp/account.txt              dry run (default): checks everything, saves nothing
//   npm run account:import -- /tmp/account.txt --confirm    imports for real, in one transaction
//
// On Railway, run it inside the backend (railway ssh) so it uses the
// backend's private DATABASE_URL. It never overwrites or deletes anything:
// an existing account with the same email or id stops it, and running it
// again after a successful import changes nothing. No migrations are run.
// Never prints the password hash, saved data or the database address.
import { existsSync, readFileSync } from 'node:fs';
import { decodeBundle, describeBundle, importAccount } from '../server/accountTransfer.js';
import { describeTarget, maskSecrets, openDatabase } from '../server/db.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const target = String(process.env.DATABASE_URL || '').trim();
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const confirm = args.includes('--confirm');

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (!file || args.some((a) => a.startsWith('--') && a !== '--confirm')) stop('Usage: npm run account:import -- FILE [--confirm]');
// Same rule as db:check: without DATABASE_URL only an existing local dev database is used.
if (!target && (process.env.RAILWAY_PROJECT_ID || !existsSync('data/pglite'))) {
  stop('DATABASE_URL is not set here, so there is no database to import into. Nothing was changed.');
}
const where = target || 'data/pglite';

let bundle;
try {
  bundle = decodeBundle(readFileSync(file, 'utf8'));
} catch (err) {
  stop(`${err.code === 'ENOENT' ? `No file at ${file}.` : err.message} Nothing was changed.`);
}

console.log(`Target: ${describeTarget(where)}`);
console.log(confirm ? 'Mode: IMPORT (--confirm)' : 'Mode: DRY RUN (nothing will be saved; add --confirm to import)');
for (const line of describeBundle(bundle)) console.log(line);
let db;
try {
  db = await openDatabase(where, { migrate: false });
  for (const line of await importAccount(db, bundle, { confirm })) console.log(line);
} catch (err) {
  console.error(`\nStopped: ${maskSecrets(err.message, where)} Everything was rolled back; nothing was changed.`);
  process.exitCode = 1;
} finally {
  await db?.close();
}
