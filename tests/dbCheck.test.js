import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../server/api.js';
import { openDatabase } from '../server/db.js';
import { inspectAccounts } from '../server/dbCheck.js';
import { call } from './helpers.js';

// Runs scripts/db-check.mjs as on Railway: env decides the database. Never production.
function runScript(args, env = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'DATABASE_URL' && !k.startsWith('RAILWAY_')));
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/db-check.mjs', ...args], { env: { ...clean, ...env }, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('db:check finds an account inside a READ ONLY transaction and prints no secrets', async () => {
  const db = await openDatabase(':memory:');
  const api = createApi({}, { db, log: { info() {}, error() {} } });
  const signup = await call(api, 'POST', '/auth/signup', { email: 'Owner@Example.com', password: 'a long pass phrase' });
  const cookie = String(signup.headers['set-cookie']).split(';')[0];
  await call(api, 'PUT', '/data', { baseRevision: 0, data: { profile: { name: 'Owner' } } }, { headers: { cookie } });
  await call(api, 'POST', '/auth/forgot', { email: 'owner@example.com' });
  const before = await db.one('SELECT password_hash FROM users');

  await db.exec('BEGIN TRANSACTION READ ONLY'); // Any write in the check would fail here.
  const found = (await inspectAccounts(db, '  OWNER@example.com ')).join('\n');
  const missing = (await inspectAccounts(db, 'nobody@example.com')).join('\n');
  await db.exec('ROLLBACK');

  assert.match(found, /Schema version: (\d+) of \1 \(all migrations applied\)/);
  assert.match(found, /Accounts: 1/);
  assert.match(found, /Account for the given email: FOUND/);
  assert.match(found, /Signed-in sessions: 1/);
  assert.match(found, /Reset links: 1 usable now, 0 expired or used/);
  assert.match(found, /Saved app data: yes/);
  assert.match(missing, /Account for the given email: NOT FOUND/);
  const { token_hash } = await db.one('SELECT token_hash FROM password_resets');
  for (const secret of ['owner@example.com', before.password_hash, token_hash, cookie.split('=')[1]]) assert.ok(!found.includes(secret), 'no email, hash or token');
  assert.equal((await db.one('SELECT password_hash FROM users')).password_hash, before.password_hash, 'nothing changed');
});

test('db:check reports an empty schema and passes database errors on', async () => {
  assert.match((await inspectAccounts({ one: async () => ({ v: null, u: null }) }))[0], /NOT initialized/);
  await assert.rejects(inspectAccounts({ one: async () => { throw new Error('relation "users" does not exist'); } }), /does not exist/);
});

test('db:check script: connects, rejects bad input, refuses without DATABASE_URL on Railway, hides credentials', () => {
  const ok = runScript(['someone@example.com'], { DATABASE_URL: ':memory:' });
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Accounts: 0/);
  assert.match(ok.out, /NOT FOUND/);
  assert.ok(!ok.out.includes('someone@example.com'), 'the email is not printed');

  const bad = runScript(['not-an-email'], { DATABASE_URL: ':memory:' });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /not a valid email address/);

  const railway = runScript(['someone@example.com'], { RAILWAY_PROJECT_ID: 'p' });
  assert.equal(railway.code, 1);
  assert.match(railway.out, /DATABASE_URL is not set here/);
  // A shell without the backend's variables and without a local database (like a server) is refused too.
  const noLocal = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/db-check.mjs', import.meta.url))], { cwd: mkdtempSync(join(tmpdir(), 'fja-')), env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(noLocal.status, 1);
  assert.match(noLocal.stdout + noLocal.stderr, /DATABASE_URL is not set here/);

  const down = runScript([], { DATABASE_URL: 'postgresql://dbuser:Sup3r%21Secret@127.0.0.1:1/railway' });
  assert.equal(down.code, 1);
  assert.match(down.out, /Couldn’t connect to PostgreSQL at 127\.0\.0\.1:1\/railway/);
  for (const secret of ['Sup3r', 'dbuser', 'postgresql://']) assert.ok(!down.out.includes(secret), `no ${secret} in the output`);
});
