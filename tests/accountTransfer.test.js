import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../server/api.js';
import { decodeBundle, encodeBundle, exportAccount, importAccount } from '../server/accountTransfer.js';
import { TABLES, openDatabase } from '../server/db.js';
import { call } from './helpers.js';

const quiet = { info() {}, warn() {}, error() {} };
const PASSWORD = 'my original phrase';

// A local database like the real one: the owner (with data, AI usage, sessions,
// Stripe test records) and another user who must never be exported.
async function source() {
  const db = await openDatabase(':memory:');
  const api = createApi({}, { db, log: quiet });
  const res = await call(api, 'POST', '/auth/signup', { email: 'owner@example.com', password: PASSWORD });
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  await call(api, 'PUT', '/data', { baseRevision: 0, data: { profile: { name: 'Owner' }, applications: [{ id: 'a1', company: 'Acme', title: 'Intern' }] } }, { headers: { cookie } });
  const { id } = await db.one('SELECT id FROM users');
  await db.run("INSERT INTO ai_usage (user_id, period, count) VALUES ($1, '2026-10', 3)", [id]);
  await db.run("INSERT INTO billing_customers (user_id, stripe_customer_id, created_at) VALUES ($1, 'cus_test', 'now')", [id]);
  await db.run("INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, plan, status, updated_at) VALUES ('sub_test', $1, 'cus_test', 'premium', 'active', 'now')", [id]);
  await call(api, 'POST', '/auth/signup', { email: 'other@example.com', password: 'someone else phrase' }, { ip: '10.0.0.9' });
  return { db, id };
}

const counts = async (db) => (await db.one('SELECT (SELECT COUNT(*) FROM users)::int AS users, (SELECT COUNT(*) FROM user_data)::int AS data, (SELECT COUNT(*) FROM ai_usage)::int AS ai')) ;

test('export holds only the one account and its data, and survives the text format', async () => {
  const { db, id } = await source();
  const bundle = await exportAccount(db, '  OWNER@Example.com ');
  const text = encodeBundle(bundle);
  assert.ok(text.split('\n').every((l) => l.length <= 76 || l.startsWith('-----')), 'short lines, safe to paste');
  assert.ok(!text.includes('other@example.com') && !text.includes('cus_test') && !text.includes('sub_test'));
  const back = decodeBundle(`pasted with spaces\n  ${text.replace(/\n/g, '\r\n  ')}`);
  assert.equal(back.user.id, id);
  assert.deepEqual(back.leftBehind, { sessions: 1, resetLinks: 0, stripeCustomers: 1, subscriptions: 1 });
  assert.equal(back.aiUsage.length, 1);
  await assert.rejects(exportAccount(db, 'missing@example.com'), /No account with that email/);
});

test('dry run saves nothing; import copies the account; it can sign in and reset; a second run changes nothing', async () => {
  const { db: src } = await source();
  const bundle = decodeBundle(encodeBundle(await exportAccount(src, 'owner@example.com')));
  const target = await openDatabase(':memory:');
  const before = await counts(target);
  const everyTable = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await target.one(`SELECT COUNT(*)::int AS n FROM ${t}`)).n])));
  const tablesBefore = await everyTable();

  const dry = (await importAccount(target, bundle)).join('\n');
  assert.match(dry, /DRY RUN/);
  assert.match(dry, /exactly one account added/);
  assert.deepEqual(await counts(target), before, 'dry run left the database unchanged');
  assert.deepEqual(await everyTable(), tablesBefore, 'no table changed in the dry run');

  const real = (await importAccount(target, bundle, { confirm: true })).join('\n');
  assert.match(real, /IMPORTED/);
  for (const check of ['password hash preserved', 'saved app data identical', 'AI usage identical', 'no sessions, reset links or Stripe records copied']) assert.match(real, new RegExp(check));
  assert.deepEqual(await counts(target), { users: 1, data: 1, ai: 1 });

  const api = createApi({}, { db: target, log: { ...quiet, info: (m) => logs.push(m) } });
  const logs = [];
  const signin = await call(api, 'POST', '/auth/signin', { email: 'Owner@example.com', password: PASSWORD });
  assert.equal(signin.status, 200, 'the original password still works');
  const data = await call(api, 'GET', '/data', undefined, { headers: { cookie: String(signin.headers['set-cookie']).split(';')[0] } });
  assert.equal(data.body.data.applications[0].company, 'Acme');
  await call(api, 'POST', '/auth/forgot', { email: 'owner@example.com' });
  assert.match(logs.join('\n'), /reset-password\?token=/, 'password recovery finds the account');

  assert.match((await importAccount(target, bundle, { confirm: true }))[0], /Already imported/);
  assert.deepEqual(await counts(target), { users: 1, data: 1, ai: 1 }, 'no duplicates');
});

test('import refuses existing accounts and invalid files, and rolls back on any failure', async () => {
  const { db: src } = await source();
  const bundle = decodeBundle(encodeBundle(await exportAccount(src, 'owner@example.com')));

  const taken = await openDatabase(':memory:');
  await call(createApi({}, { db: taken, log: quiet }), 'POST', '/auth/signup', { email: 'owner@example.com', password: 'a different phrase' });
  const hashBefore = (await taken.one('SELECT password_hash FROM users')).password_hash;
  await assert.rejects(importAccount(taken, bundle, { confirm: true }), /already exists .* never overwritten/);
  assert.equal((await taken.one('SELECT password_hash FROM users')).password_hash, hashBefore, 'existing account untouched');

  const idTaken = await openDatabase(':memory:');
  await idTaken.run("INSERT INTO users (id, email, password_hash, created_at, password_changed_at) VALUES ($1, 'x@example.com', 'h', 'now', 'now')", [bundle.user.id]);
  await assert.rejects(importAccount(idTaken, bundle, { confirm: true }), /already uses this user id/);

  const clone = () => JSON.parse(JSON.stringify(bundle));
  const target = await openDatabase(':memory:');
  const bad = [
    [{ ...clone(), format: 'other' }, /unknown format/],
    [{ ...clone(), user: { ...bundle.user, password_hash: 'plain-text' } }, /password hash/],
    [{ ...clone(), userData: { ...bundle.userData, user_id: 'someone-else' } }, /different user id/],
    [{ ...clone(), aiUsage: [{ user_id: 'someone-else', period: '2026-10', count: 1 }] }, /different user id/],
    [{ ...clone(), userData: { ...bundle.userData, data: '{not json' } }, /not valid JSON/],
  ];
  for (const [b, msg] of bad) await assert.rejects(importAccount(target, b, { confirm: true }), msg);
  const text = encodeBundle(bundle);
  assert.throws(() => decodeBundle(text.replace(/\n[A-Za-z0-9+/=]{76}\n/, '\n')), /damaged/, 'a line lost while pasting');
  assert.throws(() => decodeBundle('hello'), /not a First Job AI account file/);

  // A failure after the user row was written: the whole import is rolled back.
  const failing = { ...target, tx: (fn) => target.tx((t) => fn({ ...t, run: async (sql, p) => { if (sql.includes('ai_usage')) throw new Error('insert or update violates foreign key constraint'); return t.run(sql, p); } })) };
  await assert.rejects(importAccount(failing, bundle, { confirm: true }), /foreign key/);
  assert.deepEqual(await counts(target), { users: 0, data: 0, ai: 0 }, 'rolled back');

  await assert.rejects(importAccount(await openDatabase(':memory:', { migrate: false }), bundle), /schema is missing/);
});

test('account scripts end to end: export reads data/pglite only, dry run, import, rerun; no secrets printed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fja-transfer-'));
  try {
    // The "local" database the export must read: <cwd>/data/pglite.
    const local = await openDatabase(join(dir, 'data', 'pglite'));
    const localApi = createApi({}, { db: local, log: quiet });
    const signup = await call(localApi, 'POST', '/auth/signup', { email: 'owner@example.com', password: PASSWORD });
    await call(localApi, 'PUT', '/data', { baseRevision: 0, data: { profile: { name: 'Shift lead at Riverside Cafe' } } }, { headers: { cookie: String(signup.headers['set-cookie']).split(';')[0] } });
    const hash = (await local.one('SELECT password_hash FROM users')).password_hash;
    await local.close();
    const targetDir = join(dir, 'target');
    await (await openDatabase(targetDir)).close(); // An empty, migrated "production" database.

    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'DATABASE_URL' && k !== 'APP_URL' && !k.startsWith('RAILWAY_')));
    const run = (script, args, env = {}, cwd = dir) => {
      const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), ...args], { cwd, env: { ...base, ...env }, encoding: 'utf8', timeout: 60000 });
      return { code: r.status, out: r.stdout + r.stderr };
    };
    const file = join(dir, 'account.txt');
    // DATABASE_URL points at "production": the export must still read the local database.
    const exp = run('account-export.mjs', ['owner@example.com', file], { DATABASE_URL: targetDir });
    assert.equal(exp.code, 0, exp.out);
    assert.match(exp.out, /Source: local development database \(PGlite\) in data\/pglite/);
    assert.equal(decodeBundle(readFileSync(file, 'utf8')).user.password_hash, hash, 'the hash is kept');
    assert.match(run('account-export.mjs', ['owner@example.com', file]).out, /Export failed/, 'never overwrites a file');
    assert.match(run('account-export.mjs', ['nobody@example.com', join(dir, 'x.txt')]).out, /No account with that email/);
    assert.match(run('account-export.mjs', ['owner@example.com'], {}, targetDir).out, /No local database/, 'never creates an empty database');

    const env = { DATABASE_URL: targetDir };
    const dry = run('account-import.mjs', [file], env);
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /DRY RUN/);
    const real = run('account-import.mjs', [file, '--confirm'], env);
    assert.equal(real.code, 0, real.out);
    assert.match(real.out, /IMPORTED/);
    assert.match(real.out, /saved app data identical/);
    assert.match(run('account-import.mjs', [file, '--confirm'], env).out, /Already imported/);
    assert.match(run('account-import.mjs', [file, '--yes'], env).out, /Usage/, 'only --confirm imports');

    // Output captured by a pipe (like a log collector): the reset link is never printed.
    const reset = run('reset-link.mjs', ['owner@example.com'], { ...env, APP_URL: 'https://site.example' });
    assert.equal(reset.code, 1);
    assert.match(reset.out, /only shown in an interactive terminal/);
    assert.ok(!/token=/.test(reset.out));
    const db = await openDatabase(targetDir, { migrate: false });
    assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM password_resets')).n, 0, 'no reset link was created');
    await db.close();

    for (const out of [exp.out, dry.out, real.out]) {
      for (const secret of [hash, hash.split('$')[5], 'owner@example.com', 'Riverside Cafe']) assert.ok(!out.includes(secret), `printed: ${secret === hash ? 'the hash' : secret}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
