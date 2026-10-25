// Moves ONE account and the data it owns from one database to another
// (npm run account:export / account:import). Used to bring a local account
// into production without touching anyone else.
//
// Copied: the users row (same id and password hash), user_data and ai_usage.
// Never copied: sessions, reset links, Stripe customers/subscriptions, other users.
// The file is plain text in short lines (safe to paste into a terminal) with
// a SHA-256 checksum, so a damaged paste is refused.
import { createHash } from 'node:crypto';
import { validateEmail, verifyPassword } from './auth.js';
import { sanitizeUserData } from './dataHandler.js';
import { MIGRATIONS } from './db.js';

const FORMAT = 'first-job-ai-account';
const BEGIN = '-----BEGIN FIRST JOB AI ACCOUNT-----';
const END = '-----END FIRST JOB AI ACCOUNT-----';
const HASH_RE = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Reads the account with this email. Throws if it doesn't exist.
export async function exportAccount(db, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (validateEmail(normalized)) throw new Error('That is not a valid email address.');
  const user = await db.one('SELECT id, email, password_hash, created_at, password_changed_at, plan FROM users WHERE email = $1', [normalized]);
  if (!user) throw new Error('No account with that email in this database.');
  const count = async (table) => (await db.one(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`, [user.id])).n;
  return {
    format: FORMAT,
    version: 1,
    schemaVersion: (await db.one('SELECT version FROM schema_version')).version,
    user,
    userData: await db.one('SELECT user_id, data, revision, updated_at FROM user_data WHERE user_id = $1', [user.id]),
    aiUsage: await db.all('SELECT user_id, period, count FROM ai_usage WHERE user_id = $1 ORDER BY period', [user.id]),
    // For the report only: what stays behind.
    leftBehind: { sessions: await count('sessions'), resetLinks: await count('password_resets'), stripeCustomers: await count('billing_customers'), subscriptions: await count('subscriptions') },
  };
}

export function encodeBundle(bundle) {
  const payload = JSON.stringify(bundle);
  const b64 = Buffer.from(JSON.stringify({ sha256: sha256(payload), payload })).toString('base64');
  return [BEGIN, ...b64.match(/.{1,76}/g), END, ''].join('\n');
}

export function decodeBundle(text) {
  const s = String(text || '');
  const start = s.indexOf(BEGIN);
  const end = s.indexOf(END);
  if (start === -1 || end <= start) throw new Error('This is not a First Job AI account file (BEGIN/END lines missing).');
  let outer;
  try {
    outer = JSON.parse(Buffer.from(s.slice(start + BEGIN.length, end).replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8'));
  } catch {
    throw new Error('The account file is damaged (it could not be read). Copy it again, completely.');
  }
  if (typeof outer?.payload !== 'string' || sha256(outer.payload) !== outer.sha256) {
    throw new Error('The account file is damaged (checksum mismatch). Copy it again, completely.');
  }
  return validateBundle(JSON.parse(outer.payload));
}

// Checks every field and every relationship before anything is written.
export function validateBundle(b) {
  const fail = (msg) => {
    throw new Error(`Invalid account file: ${msg}.`);
  };
  if (b?.format !== FORMAT || b.version !== 1) fail('unknown format or version');
  if (!Number.isInteger(b.schemaVersion) || b.schemaVersion < 1 || b.schemaVersion > MIGRATIONS.length) fail('it was made with a different database schema');
  const u = b.user || {};
  if (typeof u.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(u.id)) fail('bad user id');
  if (typeof u.email !== 'string' || u.email !== u.email.trim().toLowerCase() || validateEmail(u.email)) fail('bad email');
  if (typeof u.password_hash !== 'string' || !HASH_RE.test(u.password_hash)) fail('the password hash is not in the format the app uses');
  for (const k of ['created_at', 'password_changed_at']) if (typeof u[k] !== 'string' || Number.isNaN(Date.parse(u[k]))) fail(`bad ${k}`);
  if (typeof u.plan !== 'string') fail('bad plan');
  if (b.userData !== null) {
    const d = b.userData || {};
    if (d.user_id !== u.id) fail('saved data belongs to a different user id');
    if (!Number.isInteger(d.revision) || d.revision < 1 || typeof d.updated_at !== 'string') fail('bad saved-data revision');
    let parsed;
    try {
      parsed = JSON.parse(d.data);
    } catch {
      fail('saved data is not valid JSON');
    }
    sanitizeUserData(parsed); // Same limits the server applies when the app saves.
  }
  if (!Array.isArray(b.aiUsage)) fail('bad AI usage list');
  for (const a of b.aiUsage) {
    if (a?.user_id !== u.id) fail('AI usage belongs to a different user id');
    if (!/^\d{4}-\d{2}$/.test(a.period) || !Number.isInteger(a.count) || a.count < 0) fail('bad AI usage row');
  }
  return b;
}

export function describeBundle(b) {
  const left = b.leftBehind || {};
  return [
    'Account file: 1 account',
    `  Password hash: kept (same format as production), password last changed ${b.user.password_changed_at.slice(0, 10)}`,
    `  Saved app data: ${b.userData ? `yes (${Buffer.byteLength(b.userData.data)} bytes, revision ${b.userData.revision})` : 'none'}`,
    `  AI usage months: ${b.aiUsage.length}`,
    `  Not copied: ${left.sessions ?? 0} session(s), ${left.resetLinks ?? 0} reset link(s), ${left.stripeCustomers ?? 0} Stripe customer(s), ${left.subscriptions ?? 0} subscription(s)`,
  ];
}

class DryRun extends Error {}

// Imports the bundle in one transaction. confirm=false (dry run) does all the
// same inserts and checks, then rolls back. Returns report lines; throws (and
// changes nothing) on any problem.
export async function importAccount(db, bundle, { confirm = false } = {}) {
  const b = validateBundle(bundle);
  const u = b.user;
  const lines = [];
  const version = (await db.one("SELECT to_regclass('public.schema_version') AS v"))?.v ? (await db.one('SELECT version FROM schema_version'))?.version : null;
  if (version == null || version < b.schemaVersion) throw new Error('The target database schema is missing or older than the file. Start the backend once so it is set up, then try again.');

  const byEmail = await db.one('SELECT id, password_hash FROM users WHERE email = $1', [u.email]);
  const byId = await db.one('SELECT email FROM users WHERE id = $1', [u.id]);
  if (byEmail && byEmail.id === u.id && byEmail.password_hash === u.password_hash) {
    // Its data may have changed since (it is in use), so it is left exactly as it is.
    return ['Already imported: this account is in the database with the same id and password hash. Nothing was changed.'];
  }
  if (byEmail) throw new Error('An account with this email already exists in the target database (a different account). Nothing was changed; it is never overwritten.');
  if (byId) throw new Error('Another account already uses this user id in the target database. Nothing was changed.');

  const before = (await db.one('SELECT COUNT(*)::int AS n FROM users')).n;
  try {
    await db.tx(async (t) => {
      await t.run('INSERT INTO users (id, email, password_hash, created_at, password_changed_at, plan) VALUES ($1, $2, $3, $4, $5, $6)', [
        u.id, u.email, u.password_hash, u.created_at, u.password_changed_at, u.plan,
      ]);
      if (b.userData) {
        await t.run('INSERT INTO user_data (user_id, data, revision, updated_at) VALUES ($1, $2, $3, $4)', [u.id, b.userData.data, b.userData.revision, b.userData.updated_at]);
      }
      for (const a of b.aiUsage) await t.run('INSERT INTO ai_usage (user_id, period, count) VALUES ($1, $2, $3)', [u.id, a.period, a.count]);
      const report = await verifyImport(t, b, before);
      if (!confirm) {
        lines.push('DRY RUN: every insert and check succeeded, then everything was rolled back. Nothing was saved.', ...report);
        throw new DryRun();
      }
      lines.push('IMPORTED in one transaction.', ...report);
    });
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
  }
  return lines;
}

// Reads the account back and compares it with the file. Throws on any difference.
export async function verifyImport(db, b, usersBefore = null) {
  const u = b.user;
  const row = await db.one('SELECT id, password_hash FROM users WHERE email = $1', [u.email]); // The same lookup sign-in and reset use.
  const check = (ok, msg) => {
    if (!ok) throw new Error(`Verification failed: ${msg}.`);
    return `  ✔ ${msg}`;
  };
  const data = await db.one('SELECT user_id, data, revision FROM user_data WHERE user_id = $1', [u.id]);
  const usage = await db.all('SELECT user_id, period, count FROM ai_usage WHERE user_id = $1 ORDER BY period', [u.id]);
  const extra = (await db.one('SELECT (SELECT COUNT(*) FROM sessions WHERE user_id = $1) + (SELECT COUNT(*) FROM password_resets WHERE user_id = $1) + (SELECT COUNT(*) FROM billing_customers WHERE user_id = $1) + (SELECT COUNT(*) FROM subscriptions WHERE user_id = $1) AS n', [u.id])).n;
  const lines = [
    check(row?.id === u.id, 'account exists under its original id and is found by its email (sign-in and password reset use this lookup)'),
    check(row.password_hash === u.password_hash, 'password hash preserved'),
    // A wrong password must be rejected without an error: proves the stored hash is usable by sign-in.
    check((await verifyPassword('not-the-password-' + Math.random(), row.password_hash)) === false, 'password hash works with the sign-in code'),
    check(b.userData ? data?.data === b.userData.data && data.revision === b.userData.revision : !data, 'saved app data identical'),
    check(usage.length === b.aiUsage.length && usage.every((a, i) => a.period === b.aiUsage[i].period && a.count === b.aiUsage[i].count), 'AI usage identical'),
    check([data, ...usage].filter(Boolean).every((r) => r.user_id === u.id), 'all copied rows belong to this account'),
    check(Number(extra) === 0, 'no sessions, reset links or Stripe records copied'),
  ];
  if (usersBefore !== null) {
    lines.push(check((await db.one('SELECT COUNT(*)::int AS n FROM users')).n === usersBefore + 1, 'exactly one account added, no other users'));
  }
  return lines;
}
