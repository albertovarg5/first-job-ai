// Read-only database check: npm run db:check -- you@example.com
//
// On Railway, run it inside the backend so it uses the backend's private
// DATABASE_URL (no public database address needed):
//   railway ssh -- npm run db:check -- you@example.com
// Without DATABASE_URL (your own computer) it checks the LOCAL development database.
//
// PostgreSQL is opened in a read-only session and the queries run in a READ
// ONLY transaction that is rolled back, so the database refuses any write.
// Migrations are not run. Prints the host and database name (never the
// password or the full address), counts and dates: never emails, hashes or tokens.
import { existsSync } from 'node:fs';
import { validateEmail } from '../server/auth.js';
import { describeTarget, isPostgresUrl, openDatabase } from '../server/db.js';
import { inspectAccounts } from '../server/dbCheck.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const target = String(process.env.DATABASE_URL || '').trim();
const email = String(process.argv[2] || '').trim();

// Error messages are printed without the address or its password.
function safe(message) {
  let out = String(message);
  if (target) out = out.replaceAll(target, '<DATABASE_URL>');
  try {
    const { password } = new URL(target);
    if (password) out = out.replaceAll(decodeURIComponent(password), '***').replaceAll(password, '***');
  } catch {
    /* not a URL */
  }
  return out;
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (email && validateEmail(email)) stop('That is not a valid email address. Usage: npm run db:check -- you@example.com');
// Without DATABASE_URL, only an existing local dev database is checked (never an empty new one on a server).
if (!target && (process.env.RAILWAY_PROJECT_ID || !existsSync('data/pglite'))) {
  stop('DATABASE_URL is not set here, so there is nothing to check. Run it in the backend service: railway ssh -- npm run db:check -- you@example.com');
}

const where = target || 'data/pglite';
let db;
let close;
try {
  if (isPostgresUrl(where)) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: where, connectionTimeoutMillis: 15000, options: '-c default_transaction_read_only=on' });
    await client.connect();
    db = { one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null };
    close = () => client.end();
  } else {
    db = await openDatabase(where); // Local development or test database only.
    close = () => db.close();
  }
} catch (err) {
  stop(`Couldn’t connect to ${describeTarget(where)}: ${safe(err.message)}. Nothing was read or changed.`);
}

console.log(`Database: ${describeTarget(where)}${isPostgresUrl(where) ? ' (connected, read-only)' : ' (LOCAL, not production)'}`);
try {
  await db.one('BEGIN TRANSACTION READ ONLY');
  for (const line of await inspectAccounts(db, email)) console.log(line);
} catch (err) {
  console.error(`Database error: ${safe(err.message)}. Nothing was changed.`);
  process.exitCode = 1;
} finally {
  await db.one('ROLLBACK').catch(() => {});
  await close();
}
