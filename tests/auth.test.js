import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, sameOriginJson } from '../server/api.js';
import { hashPassword, validatePassword, verifyPassword } from '../server/auth.js';
import { openDatabase } from '../server/db.js';
import { sanitizeUserData } from '../server/dataHandler.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from './helpers.js';

async function setup(env = {}) {
  const db = await openDatabase(':memory:');
  const logs = [];
  const api = createApi(env, { db, log: { info: (m) => logs.push(m), error() {} } });
  return { api, db, logs };
}

const cookieFrom = (res) => String(res.headers['set-cookie'] || '').split(';')[0];

async function signUp(api, email, password = 'correct horse battery', ip) {
  const res = await call(api, 'POST', '/auth/signup', { email, password }, { ip });
  return { res, cookie: cookieFrom(res) };
}

test('passwords are hashed with a salt and verified in constant time', async () => {
  const a = await hashPassword('my secret phrase');
  const b = await hashPassword('my secret phrase');
  assert.notEqual(a, b);
  assert.ok(!a.includes('my secret phrase'));
  assert.equal(await verifyPassword('my secret phrase', a), true);
  assert.equal(await verifyPassword('wrong', a), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.ok(validatePassword('short'));
  assert.ok(validatePassword('password'));
  assert.equal(validatePassword('a good long phrase'), null);
});

test('sign up, session cookie, me, sign out', async () => {
  const { api } = await setup();
  const { res, cookie } = await signUp(api, 'Sam@Example.com');
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'sam@example.com');
  const setCookie = res.headers['set-cookie'];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.ok(!/Secure/.test(setCookie), 'no Secure flag in development');

  const me = await call(api, 'GET', '/auth/me', undefined, { headers: { cookie } });
  assert.equal(me.body.user.email, 'sam@example.com');

  const dup = await signUp(api, 'sam@example.com');
  assert.equal(dup.res.status, 409);

  await call(api, 'POST', '/auth/signout', {}, { headers: { cookie } });
  const after = await call(api, 'GET', '/auth/me', undefined, { headers: { cookie } });
  assert.equal(after.body.user, null);
});

test('sign in rejects wrong passwords with a generic message and rate limits', async () => {
  const { api } = await setup();
  await signUp(api, 'kim@example.com');
  const bad = await call(api, 'POST', '/auth/signin', { email: 'kim@example.com', password: 'nope nope nope' });
  assert.equal(bad.status, 401);
  const unknown = await call(api, 'POST', '/auth/signin', { email: 'nobody@example.com', password: 'nope nope nope' });
  assert.equal(unknown.status, 401);
  assert.equal(bad.body.error, unknown.body.error);
  const good = await call(api, 'POST', '/auth/signin', { email: 'KIM@example.com', password: 'correct horse battery' });
  assert.equal(good.status, 200);
  let last;
  for (let i = 0; i < 8; i += 1) last = await call(api, 'POST', '/auth/signin', { email: 'kim@example.com', password: 'wrong guess here' });
  assert.equal(last.status, 429);
});

test('each user can only read and write their own data', async () => {
  const { api } = await setup();
  const a = await signUp(api, 'a@example.com', 'alpha alpha alpha', '10.0.0.1');
  const b = await signUp(api, 'b@example.com', 'bravo bravo bravo', '10.0.0.2');

  assert.equal((await call(api, 'GET', '/data')).status, 401, 'no session → no data');

  const save = await call(api, 'PUT', '/data', { baseRevision: 0, data: { profile: { name: 'A' }, applications: [{ id: 'x', company: 'Acme', title: 'Intern' }] } }, { headers: { cookie: a.cookie } });
  assert.equal(save.status, 200);
  assert.equal(save.body.revision, 1);

  const bData = await call(api, 'GET', '/data', undefined, { headers: { cookie: b.cookie } });
  assert.equal(bData.body.data, null, "B must not see A's data");

  const aData = await call(api, 'GET', '/data', undefined, { headers: { cookie: a.cookie } });
  assert.equal(aData.body.data.profile.name, 'A');
  assert.equal(aData.body.data.applications[0].company, 'Acme');

  // A forged cookie gets nothing.
  assert.equal((await call(api, 'GET', '/data', undefined, { headers: { cookie: 'fja_session=forged' } })).status, 401);
});

test('saves from an out-of-date tab are rejected as conflicts', async () => {
  const { api } = await setup();
  const { cookie } = await signUp(api, 'c@example.com');
  const put = (baseRevision, name) => call(api, 'PUT', '/data', { baseRevision, data: { profile: { name } } }, { headers: { cookie } });
  assert.equal((await put(0, 'one')).body.revision, 1);
  assert.equal((await put(1, 'two')).body.revision, 2);
  const stale = await put(1, 'stale');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'conflict');
  assert.equal(stale.body.revision, 2);
});

test('stored data is validated and normalized', () => {
  assert.throws(() => sanitizeUserData([]), /object/);
  const d = sanitizeUserData({ applications: [{ id: 'a' }, { id: 'a' }, 'junk', { noId: true }], savedJobs: [{ id: 'j', job: {} }, { id: 'j', job: {} }] });
  assert.equal(d.applications.length, 1);
  assert.equal(d.savedJobs.length, 1);
  assert.throws(() => sanitizeUserData({ applications: Array.from({ length: 2001 }, (_, i) => ({ id: String(i) })) }), /Too many/);
});

test('cross-site and non-JSON writes are blocked', async () => {
  const { api } = await setup();
  const res = await call(api, 'POST', '/auth/signin', { email: 'a@b.co', password: 'x' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(sameOriginJson({ method: 'POST', headers: { 'content-type': 'text/plain', host: 'h' } }), false);
  assert.equal(sameOriginJson({ method: 'POST', headers: { 'content-type': 'application/json', host: 'h', origin: 'http://h' } }), true);
  assert.equal(sameOriginJson({ method: 'GET', headers: {} }), true);
});

test('password reset: token works once, signs out other sessions', async () => {
  const { api, logs } = await setup();
  const { cookie: oldCookie } = await signUp(api, 'r@example.com');
  const forgot = await call(api, 'POST', '/auth/forgot', { email: 'r@example.com' });
  assert.equal(forgot.status, 200);
  const unknown = await call(api, 'POST', '/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(unknown.body.message, forgot.body.message, 'same answer for unknown emails');
  const link = logs.join('\n').match(/reset-password\?token=([\w-]+)/);
  assert.ok(link, 'development prints the link to the server log');
  const token = link[1];

  assert.equal((await call(api, 'POST', '/auth/reset', { token, password: 'short' })).status, 400);
  const ok = await call(api, 'POST', '/auth/reset', { token, password: 'a brand new phrase' });
  assert.equal(ok.status, 200);
  assert.equal((await call(api, 'POST', '/auth/reset', { token, password: 'another new phrase' })).status, 400, 'token is single use');
  assert.equal((await call(api, 'GET', '/auth/me', undefined, { headers: { cookie: oldCookie } })).body.user, null);
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'r@example.com', password: 'a brand new phrase' })).status, 200);
});

test('password reset is refused in production without email, and cookies are Secure', async () => {
  const { api } = await setup({ NODE_ENV: 'production' });
  const res = await call(api, 'POST', '/auth/forgot', { email: 'x@example.com' });
  assert.equal(res.status, 501);
  const { res: signup } = await signUp(api, 'p@example.com');
  assert.match(signup.headers['set-cookie'], /Secure/);
});

test('change password and delete account need the current password', async () => {
  const { api } = await setup();
  const { cookie } = await signUp(api, 'd@example.com');
  assert.equal((await call(api, 'POST', '/auth/change-password', { currentPassword: 'wrong', newPassword: 'new long phrase' }, { headers: { cookie } })).status, 400);
  assert.equal((await call(api, 'POST', '/auth/change-password', { currentPassword: 'correct horse battery', newPassword: 'new long phrase' }, { headers: { cookie } })).status, 200);
  await call(api, 'PUT', '/data', { baseRevision: 0, data: { profile: { name: 'D' } } }, { headers: { cookie } });
  assert.equal((await call(api, 'POST', '/auth/delete-account', { password: 'correct horse battery' }, { headers: { cookie } })).status, 400);
  assert.equal((await call(api, 'POST', '/auth/delete-account', { password: 'new long phrase' }, { headers: { cookie } })).status, 200);
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'd@example.com', password: 'new long phrase' })).status, 401);
});

test('in production, AI and job search require a signed-in user', async () => {
  const { api } = await setup({ NODE_ENV: 'production', JSEARCH_API_KEY: 'k' });
  const res = await call(api, 'GET', '/jobs/search?query=developer');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'auth_required');
  assert.equal((await call(api, 'POST', '/ai/translate', { text: 'x' })).status, 401);
  // Status endpoints stay public so the app can show setup instructions.
  assert.equal((await call(api, 'GET', '/jobs/status')).status, 200);
  assert.equal((await call(api, 'GET', '/config')).body.requireAuthForApis, true);
});

test('migrations run once and data survives reopening the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fja-'));
  const file = join(dir, 'test.db');
  try {
    const first = await openDatabase(file);
    first.prepare("INSERT INTO users (id, email, password_hash, created_at, password_changed_at) VALUES ('u', 'e@x.co', 'h', 'now', 'now')").run();
    first.close();
    const second = await openDatabase(file);
    assert.equal(second.prepare('SELECT version FROM schema_version').get().version, 2);
    assert.equal(second.prepare('SELECT email FROM users').get().email, 'e@x.co');
    assert.equal(second.prepare('SELECT plan FROM users').get().plan, 'free', 'existing users start on the free plan');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
