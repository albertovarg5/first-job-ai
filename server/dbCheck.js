// Read-only report for `npm run db:check`: schema, number of accounts and,
// for one email, counts and dates only. Never returns an email, hash or token.
// db: anything with one(sql, params). The caller runs it in a READ ONLY transaction.
import { MIGRATIONS } from './db.js';

const day = (value) => (value ? String(value).slice(0, 10) : 'never');

export async function inspectAccounts(db, email = '') {
  const lines = [];
  const schema = await db.one("SELECT to_regclass('public.schema_version') AS v, to_regclass('public.users') AS u");
  if (!schema?.v || !schema?.u) {
    lines.push('Schema: NOT initialized (no schema_version or users table). The backend creates it on its first start.');
    return lines;
  }
  const version = (await db.one('SELECT version FROM schema_version'))?.version ?? 0;
  lines.push(`Schema version: ${version} of ${MIGRATIONS.length}${version >= MIGRATIONS.length ? ' (all migrations applied)' : ' (migrations pending: the backend applies them when it starts)'}`);
  lines.push(`Accounts: ${(await db.one('SELECT COUNT(*)::int AS n FROM users')).n}`);
  const odd = (await db.one('SELECT COUNT(*)::int AS n FROM users WHERE email <> LOWER(TRIM(email))')).n;
  if (odd) lines.push(`Warning: ${odd} account(s) have an email with capitals or spaces, so sign-in and reset can't find them.`);
  if (!email) return lines;

  // Same normalization as sign-up, sign-in and password reset.
  const user = await db.one('SELECT id, created_at, password_changed_at FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  if (!user) {
    lines.push('Account for the given email: NOT FOUND in this database.');
    return lines;
  }
  const now = new Date().toISOString();
  const count = async (sql) => (await db.one(sql, [user.id, now])).n;
  lines.push('Account for the given email: FOUND');
  lines.push(`  Created: ${day(user.created_at)} · password last changed: ${day(user.password_changed_at)}`);
  lines.push('  Status: can sign in with email and password (a new account only exists once its email was confirmed)');
  lines.push(`  Signed-in sessions: ${await count('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1 AND expires_at > $2')}`);
  lines.push(`  Reset links: ${await count('SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1 AND used_at IS NULL AND expires_at > $2')} usable now, ${await count('SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1 AND (used_at IS NOT NULL OR expires_at <= $2)')} expired or used`);
  lines.push(`  Saved app data: ${(await db.one('SELECT 1 AS x FROM user_data WHERE user_id = $1', [user.id])) ? 'yes' : 'no'}`);
  return lines;
}
