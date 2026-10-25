// Read-only look at a database: npm run db:check -- [you@example.com]
//
// From your own computer against Railway (paste the Postgres service's
// DATABASE_PUBLIC_URL into your own terminal, never into a chat):
//   $env:DATABASE_URL = Read-Host "Paste DATABASE_PUBLIC_URL"
//   npm run db:check -- you@example.com
//   Remove-Item Env:DATABASE_URL
//
// PostgreSQL is opened in a read-only session, so the server itself refuses
// any write. Prints the host and database name (never the password), the
// schema version, the number of accounts, and only yes/no for the email.
// Without DATABASE_URL it reads the LOCAL development database instead.
import { existsSync } from 'node:fs';
import { MIGRATIONS, describeTarget, isPostgresUrl, openDatabase } from '../server/db.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const target = String(process.env.DATABASE_URL || 'data/pglite').trim();
const email = String(process.argv[2] || '').trim().toLowerCase(); // Normalized like sign-up, sign-in and reset.

let db;
let close;
if (isPostgresUrl(target)) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: target, connectionTimeoutMillis: 15000, options: '-c default_transaction_read_only=on' });
  await client.connect();
  db = { one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null };
  close = () => client.end();
} else {
  db = await openDatabase(target);
  close = () => db.close();
}

console.log(`Database: ${describeTarget(target)}${isPostgresUrl(target) ? ' (read-only session)' : ' — LOCAL, not production'}`);
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
  await close();
}
