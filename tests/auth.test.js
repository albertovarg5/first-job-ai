import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, sameOriginJson } from '../server/api.js';
import { createResetToken, hashPassword, validatePassword, verifyPassword } from '../server/auth.js';
import { MIGRATIONS, openDatabase } from '../server/db.js';
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
  // Behind the Vercel proxy the browser's Origin is the site (APP_URL), not this server's Host.
  const proxied = { method: 'POST', headers: { 'content-type': 'application/json', host: 'api.up.railway.app', origin: 'https://firstjob.example' } };
  assert.equal(sameOriginJson(proxied, 'https://firstjob.example'), true);
  assert.equal(sameOriginJson(proxied), false);
  assert.equal(sameOriginJson({ ...proxied, headers: { ...proxied.headers, origin: 'https://evil.example' } }, 'https://firstjob.example'), false);
  const { api: behindProxy } = await setup({ APP_URL: 'https://firstjob.example' });
  const viaSite = await call(behindProxy, 'POST', '/auth/signup', { email: 'proxy@example.com', password: 'through the proxy' }, { headers: { host: 'api.up.railway.app', origin: 'https://firstjob.example' } });
  assert.equal(viaSite.status, 201);
  assert.equal((await call(behindProxy, 'POST', '/auth/signin', { email: 'proxy@example.com', password: 'through the proxy' }, { headers: { origin: 'https://evil.example' } })).status, 403);
});

// Production bug: APP_URL on Railway was not the Vercel address, so every sign-in through Vercel got 403.
test('a site that is not APP_URL is refused behind the proxy, and the log names the fix', async () => {
  const warnings = [];
  const db = await openDatabase(':memory:');
  const api = createApi({ APP_URL: 'https://example.com' }, { db, log: { info() {}, error() {}, warn: (m) => warnings.push(m) } });
  const viaVercel = { host: 'api.up.railway.app', origin: 'https://site.vercel.app' };
  const body = { email: 'a@b.co', password: 'not a real one' };
  assert.equal((await call(api, 'POST', '/auth/signin', body, { headers: viaVercel })).status, 403);
  await call(api, 'POST', '/auth/signin', body, { headers: viaVercel });
  assert.equal(warnings.length, 1, 'logged once per origin');
  assert.match(warnings[0], /https:\/\/site\.vercel\.app.*APP_URL \(https:\/\/example\.com\)/);
  assert.ok(!warnings[0].includes(body.password));

  const fixed = createApi({ APP_URL: 'https://site.vercel.app/' }, { db });
  assert.equal((await call(fixed, 'POST', '/auth/signin', body, { headers: viaVercel })).status, 401, 'trailing slash in APP_URL still matches');
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

test('a reset link made on the server (npm run reset-link) recovers the account and keeps its data', async () => {
  const { api, db } = await setup({ NODE_ENV: 'production' });
  const { cookie: oldCookie } = await signUp(api, 'owner@example.com');
  await call(api, 'PUT', '/data', { baseRevision: 0, data: { profile: { name: 'Owner' } } }, { headers: { cookie: oldCookie } });
  const { id } = await db.one('SELECT id FROM users WHERE email = $1', ['owner@example.com']);

  const token = await createResetToken(db, id);
  assert.match(token, /^[\w-]{43}$/, '256-bit random token');
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM password_resets WHERE token_hash = $1', [token])).n, 0, 'only the hash is stored');
  const reset = await call(api, 'POST', '/auth/reset', { token, password: 'my recovered phrase' });
  assert.equal(reset.status, 200);
  assert.equal((await call(api, 'POST', '/auth/reset', { token, password: 'again and again' })).status, 400, 'single use');
  assert.equal((await call(api, 'GET', '/data', undefined, { headers: { cookie: oldCookie } })).status, 401, 'old session signed out');
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'owner@example.com', password: 'correct horse battery' })).status, 401);
  const signin = await call(api, 'POST', '/auth/signin', { email: 'owner@example.com', password: 'my recovered phrase' });
  assert.equal(signin.status, 200);
  const data = await call(api, 'GET', '/data', undefined, { headers: { cookie: cookieFrom(signin) } });
  assert.equal(data.body.data.profile.name, 'Owner', 'saved data is kept');
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM users')).n, 1, 'no duplicate account');

  const expired = await createResetToken(db, id);
  await db.run("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL");
  assert.equal((await call(api, 'POST', '/auth/reset', { token: expired, password: 'too late phrase' })).status, 400, 'expired');
});

test('password reset: normalized email, invalid and concurrent tokens, rate limit, database errors', async () => {
  const { api, logs } = await setup();
  await signUp(api, 'norm@example.com');
  assert.equal((await call(api, 'POST', '/auth/forgot', { email: '  NORM@Example.COM ' })).status, 200);
  const token = logs.join('\n').match(/reset-password\?token=([\w-]+)/)?.[1];
  assert.ok(token, 'capitals and spaces find the same account');

  const invalid = await call(api, 'POST', '/auth/reset', { token: 'not-a-real-token', password: 'a brand new phrase' });
  assert.equal(invalid.body.code, 'invalid_token');
  assert.equal((await call(api, 'POST', '/auth/reset', { token, password: 'first new phrase' })).status, 200);
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'Norm@Example.com', password: 'first new phrase' })).status, 200);
  assert.ok(logs.includes('[auth] Reset link accepted: password updated and other sessions signed out.'));
  assert.ok(!logs.some((l) => l.includes('first new phrase')), 'passwords are never logged');

  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await call(api, 'POST', '/auth/forgot', { email: `x${i}@example.com` }, { ip: '10.9.9.9' })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429], 'reset requests are rate limited per address');

  const db = await openDatabase(':memory:');
  const broken = createApi({}, { db: { ...db, one: async () => { throw new Error('connection terminated: secret-host'); } }, log: { info() {}, error() {} } });
  const failed = await call(broken, 'POST', '/auth/forgot', { email: 'norm@example.com' });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, 'server_error');
  assert.ok(!JSON.stringify(failed.body).includes('secret-host'), 'database details stay on the server');
});

test('a reset link used by two requests at once changes the password only once', async () => {
  const db = await openDatabase(':memory:');
  const logs = [];
  let stale = null; // The row as a second, simultaneous request read it: before the first one used it.
  const racing = { ...db, one: (sql, p) => (stale && sql.startsWith('SELECT * FROM password_resets') ? stale : db.one(sql, p)) };
  const api = createApi({}, { db: racing, log: { info: (m) => logs.push(m), error() {} } });
  await signUp(api, 'race@example.com');
  await call(api, 'POST', '/auth/forgot', { email: 'race@example.com' });
  const token = logs.join('\n').match(/reset-password\?token=([\w-]+)/)[1];
  stale = await db.one('SELECT * FROM password_resets');
  assert.equal((await call(api, 'POST', '/auth/reset', { token, password: 'first new phrase' })).status, 200);
  assert.equal((await call(api, 'POST', '/auth/reset', { token, password: 'second new phrase' })).status, 400);
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'race@example.com', password: 'second new phrase' })).status, 401);
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'race@example.com', password: 'first new phrase' })).status, 200);
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
    await first.run("INSERT INTO users (id, email, password_hash, created_at, password_changed_at) VALUES ('u', 'e@x.co', 'h', 'now', 'now')");
    await first.close();
    const second = await openDatabase(file);
    assert.equal((await second.one('SELECT version FROM schema_version')).version, MIGRATIONS.length);
    assert.equal((await second.all('SELECT * FROM schema_version')).length, 1);
    assert.equal((await second.one('SELECT email FROM users')).email, 'e@x.co');
    assert.equal((await second.one('SELECT plan FROM users')).plan, 'free', 'existing users start on the free plan');
    await second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
