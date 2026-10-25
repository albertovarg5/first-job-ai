// Read-only look at a database: npm run db:check -- [you@example.com]
//
// Uses DATABASE_URL, or the LOCAL development database when it isn't set.
// Inside the Railway backend (railway ssh) it uses the backend's own private
// DATABASE_URL. Before it is deployed, the same file can be pasted there:
//   cd /app && node --input-type=module - you@example.com <<'EOF'
//   …this whole file…
//   EOF
//
// PostgreSQL is opened in a read-only session and every query runs in a
// READ ONLY transaction that is rolled back, so the database refuses any
// write. Prints the host and database name (never the user or password), the
// schema version, the number of accounts, and only yes/no for the email.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Loaded from the app folder (the current directory), so the pasted copy finds it too.
const { MIGRATIONS, describeTarget, isPostgresUrl, openDatabase } = await import(pathToFileURL(`${process.cwd()}/server/db.js`).href);

if (existsSync('.env')) process.loadEnvFile('.env');
const target = String(process.env.DATABASE_URL || 'data/pglite').trim();
const email = String(process.argv[2] || '').trim().toLowerCase(); // Normalized like sign-up, sign-in and reset.

if (!isPostgresUrl(target) && process.env.RAILWAY_PROJECT_ID) {
  console.error('DATABASE_URL is not set in this Railway shell, so there is nothing to check. Open the shell of the backend service (railway link, choose the backend, then railway ssh). Nothing was read or changed.');
  process.exit(1);
}

let db;
let close;
if (isPostgresUrl(target)) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: target, connectionTimeoutMillis: 15000, options: '-c default_transaction_read_only=on' });
  try {
    await client.connect();
  } catch (err) {
    console.error(`Couldn’t connect to ${describeTarget(target)}: ${err.message}. Nothing was read or changed.`);
    process.exit(1);
  }
  db ={ one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null };
  close = () => client.end();
} else {
  db = await openDatabase(target);
  close = () => db.close();
}

console.log(`Database: ${describeTarget(target)}${isPostgresUrl(target) ? ' (read-only)' : ' — LOCAL, not production'}`);
await db.one('BEGIN TRANSACTION READ ONLY');
try {
  const schema = await db.one("SELECT to_regclass('public.schema_version') AS t, to_regclass('public.users') AS u");
  if (!schema.t || !schema.u) {
    console.log('Schema: NOT initialized (no schema_version/users table). The backend creates it on its first start.');
  } else {
    const { version } = (await db.one('SELECT version FROM schema_version')) || { version: 0 };
    console.log(`Schema version: ${version} of ${MIGRATIONS.length}${version >= MIGRATIONS.length ? ' (all migrations applied)' : ' (migrations pending: the backend applies them on start)'}`);
    const { n } = await db.one('SELECT COUNT(*)::int AS n FROM users');
    console.log(`Accounts: ${n}`);
    const { odd } = await db.one('SELECT COUNT(*)::int AS odd FROM users WHERE email <> LOWER(TRIM(email))');
    if (odd) console.log(`⚠ ${odd} account(s) have an email with capitals or spaces: they can’t sign in or reset until fixed.`);
    if (email) {
      const found = await db.one('SELECT created_at FROM users WHERE email = $1', [email]);
      console.log(`Account for the given email: ${found ? `yes (created ${String(found.created_at).slice(0, 10)})` : 'no'}`);
    }
  }
} finally {
  await db.one('ROLLBACK').catch(() => {});
  await close();
}
