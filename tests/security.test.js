// Attacks from the security audit, run against the real API with an in-memory database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/api.js';
import { openDatabase } from '../server/db.js';
import { createLimits, isPrivateIp, peerIp, proxySettings } from '../server/http.js';
import { call, jsonResponse, withFetch } from './helpers.js';

const quietLog = { info() {}, warn() {}, error() {} };
const cookieFrom = (res) => String(res.headers['set-cookie'] || '').split(';')[0];
// Every cookie the response set, as one Cookie header (session + trusted device).
const allCookies = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const claudeReply = (obj) => jsonResponse({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' });
const SUMMARY = { summary: 'Business student with two years of cashier experience seeking an office role.' };

async function setup(env = {}) {
  const db = await openDatabase(':memory:');
  const logs = [];
  const log = { ...quietLog, info: (m) => logs.push(String(m)) };
  return { db, logs, api: createApi({ ANTHROPIC_API_KEY: 'sk-ant-test', ...env }, { db, log }) };
}

// The link printed in development (no email service) for the last confirmation email.
const lastLink = (logs) => logs.join('\n').match(/verify-email\?token=([\w-]+)/g)?.at(-1)?.split('=')[1];
const signUp = async (api, email, opts) => cookieFrom(await call(api, 'POST', '/auth/signup', { email, password: 'a long pass phrase' }, opts));

test('peer address: the last X-Forwarded-For entry (written by the proxy) is used, internal hops are recognized', () => {
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 203.0.113.9' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(peerIp(req, { trust: true }), '203.0.113.9');
  assert.equal(peerIp(req, { trust: false }), '10.0.0.1', 'headers are ignored without TRUST_PROXY');
  for (const ip of ['10.1.2.3', '127.0.0.1', '192.168.0.1', '172.20.0.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1', 'unknown']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['203.0.113.9', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1']) assert.ok(!isPrivateIp(ip), ip);
});

test('rate limits: a forged X-Forwarded-For sent straight to the server no longer bypasses them', async () => {
  const { api } = await setup({ TRUST_PROXY: 'true' });
  const forgot = (i, peer) =>
    call(api, 'POST', '/auth/forgot', { email: `victim${i}@example.com` }, { ip: '10.0.0.9', headers: { 'x-forwarded-for': `9.9.${i % 250}.${i % 7}, ${peer}` } });
  // Each request claims a new client address; the real sender (the last hop) is the same.
  const statuses = [];
  for (let i = 0; i < 51; i++) statuses.push((await forgot(i, '203.0.113.9')).status);
  assert.ok(statuses.slice(0, 50).every((s) => s === 200));
  assert.equal(statuses[50], 429, 'blocked once the real sender passes 10x the per-visitor limit');
  // Other senders (and real visitors behind one shared Vercel address) are not affected.
  assert.equal((await forgot(99, '198.51.100.7')).status, 200);
});

test('sessions: signing in again rotates the session; expired and signed-out tokens stop working', async () => {
  const { api, db } = await setup();
  const first = await signUp(api, 'rota@example.com');
  const second = cookieFrom(await call(api, 'POST', '/auth/signin', { email: 'rota@example.com', password: 'a long pass phrase' }, { headers: { cookie: first } }));
  assert.notEqual(first, second);
  const me = async (cookie) => (await call(api, 'GET', '/auth/me', undefined, { headers: { cookie } })).body.user;
  assert.equal(await me(first), null, 'the old token was revoked on the server');
  assert.equal((await me(second)).email, 'rota@example.com');

  await db.run('UPDATE sessions SET expires_at = $1', ['2000-01-01T00:00:00.000Z']);
  assert.equal(await me(second), null, 'an expired session is refused even though the cookie is still sent');
  assert.equal((await call(api, 'GET', '/data', undefined, { headers: { cookie: second } })).status, 401);
});

test('injection: SQL and script payloads are refused as input or stored as plain text, never executed', async () => {
  const { api, db } = await setup();
  for (const email of ["' OR '1'='1", "a@b.c'; DROP TABLE users; --", '<script>alert(1)</script>@x.io']) {
    const r = await call(api, 'POST', '/auth/signin', { email, password: "' OR '1'='1" });
    assert.ok([400, 401].includes(r.status), email);
  }
  assert.equal((await call(api, 'POST', '/auth/signin', { email: { $ne: null }, password: { $ne: null } })).status, 400, 'objects are not accepted as email');
  assert.equal((await call(api, 'POST', '/auth/signin', '{"email": "x@y.z",')).status, 400, 'broken JSON');

  const cookie = await signUp(api, 'inj@example.com');
  const payload = "<img src=x onerror=alert(1)>'; DROP TABLE user_data; --";
  const put = await call(api, 'PUT', '/data', { data: { profile: { name: payload } }, baseRevision: 0 }, { headers: { cookie } });
  assert.equal(put.status, 200);
  const got = await call(api, 'GET', '/data', undefined, { headers: { cookie } });
  assert.equal(got.body.data.profile.name, payload, 'stored verbatim');
  assert.match(got.headers['content-type'], /^application\/json/);
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM users')).n, 1, 'tables intact');
});

test('authorization: a user can only ever reach their own saved data', async () => {
  const { api } = await setup();
  const alice = await signUp(api, 'alice@example.com');
  const bob = await signUp(api, 'bob@example.com');
  await call(api, 'PUT', '/data', { data: { profile: { name: 'Alice private' } }, baseRevision: 0 }, { headers: { cookie: alice } });
  // There is no id in the route to change: the user always comes from the session.
  const bobsView = await call(api, 'GET', '/data?user_id=alice', undefined, { headers: { cookie: bob } });
  assert.equal(bobsView.body.data, null);
  assert.equal((await call(api, 'GET', '/data')).status, 401);
  assert.equal((await call(api, 'GET', '/data', undefined, { headers: { cookie: 'fja_session=forged-token' } })).status, 401);
});

test('CORS and CSRF: no cross-origin access is granted, cross-site writes are refused', async () => {
  const { api } = await setup({ APP_URL: 'https://first-job-ai-steel.vercel.app' });
  const evil = { origin: 'https://evil.example' };
  const pre = await call(api, 'OPTIONS', '/auth/signin', undefined, { headers: { ...evil, 'access-control-request-method': 'POST' } });
  assert.equal(pre.headers['access-control-allow-origin'], undefined);
  assert.equal(pre.headers['access-control-allow-credentials'], undefined);
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'a@b.co', password: 'x' }, { headers: evil })).status, 403);
  // A plain HTML form can't send JSON; anything else is refused before routing.
  assert.equal((await call(api, 'POST', '/auth/signout', 'x=1', { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 403);
  assert.equal((await call(api, 'POST', '/auth/signout', '{}', { headers: { 'content-type': 'text/plain' } })).status, 403);
  const ok = await call(api, 'POST', '/auth/signin', { email: 'a@b.co', password: 'x long pw' }, { headers: { origin: 'https://first-job-ai-steel.vercel.app' } });
  assert.equal(ok.status, 401, 'the real site reaches the route');
});

test('AI: oversized requests are refused, and Free accounts share a daily ceiling that failures do not use up', async () => {
  const { api } = await setup({ AI_FREE_DAILY_TOTAL: '2' });
  const users = [await signUp(api, 'u1@example.com'), await signUp(api, 'u2@example.com'), await signUp(api, 'u3@example.com')];
  const ai = (cookie, body = { resumeText: 'Cashier for two years', targetRole: 'Office assistant' }) => call(api, 'POST', '/ai/summary', body, { headers: { cookie } });

  const huge = await ai(users[0], { resumeText: 'x'.repeat(200000) });
  assert.equal(huge.status, 413);

  await withFetch(async () => jsonResponse({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 500), async () => assert.equal((await ai(users[0])).status, 502));
  await withFetch(
    async () => claudeReply({ summary: 'Business student with two years of cashier experience seeking an office role.' }),
    async () => {
      assert.equal((await ai(users[0])).status, 200);
      assert.equal((await ai(users[1])).status, 200);
      const blocked = await ai(users[2]);
      assert.equal(blocked.status, 429, 'many free accounts cannot add up to more than the daily ceiling');
      assert.equal(blocked.body.code, 'rate_limited');
      assert.ok(Number(blocked.headers['retry-after']) > 0);
    },
  );
  const usage = (await call(api, 'GET', '/usage', undefined, { headers: { cookie: users[2] } })).body.ai;
  assert.equal(usage.used, 0, 'the refused request was not counted against the user');
});

test('saved data: scripted save floods are rate limited per user', async () => {
  const { api } = await setup();
  const cookie = await signUp(api, 'flood@example.com');
  let revision = 0;
  let last;
  for (let i = 0; i < 301; i++) {
    last = await call(api, 'PUT', '/data', { data: {}, baseRevision: revision }, { headers: { cookie } });
    if (last.status === 200) revision = last.body.revision;
  }
  assert.equal(revision, 300);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers['retry-after']) > 0);
});

test('rate limits are stored in the database: atomic under parallel requests and kept across a restart', async () => {
  const db = await openDatabase(':memory:');
  const limits = createLimits(db);
  const rule = { limit: 5, windowMs: 60000 };
  const results = await Promise.all(Array.from({ length: 20 }, () => limits.take('burst', rule)));
  assert.equal(results.filter((r) => r.ok).length, 5, 'exactly the limit gets through, however many arrive at once');
  assert.ok(results.find((r) => !r.ok).retryAfter > 0);
  assert.equal((await limits.take('burst', rule, Date.now() + 61000)).ok, true, 'a new window starts after windowMs');

  // A "restart": a new server on the same database still remembers the failed sign-ins.
  const first = createApi({}, { db, log: quietLog });
  await call(first, 'POST', '/auth/signup', { email: 'keep@example.com', password: 'a long pass phrase' });
  for (let i = 0; i < 6; i++) await call(first, 'POST', '/auth/signin', { email: 'keep@example.com', password: 'wrong guess here' });
  const second = createApi({}, { db, log: quietLog });
  assert.equal((await call(second, 'POST', '/auth/signin', { email: 'keep@example.com', password: 'wrong guess here' })).status, 429);
});

test('lockout: a stranger guessing passwords cannot lock the owner out of a browser they used before', async () => {
  const { api } = await setup();
  const signup = await call(api, 'POST', '/auth/signup', { email: 'owner@example.com', password: 'owner pass phrase' });
  const ownerBrowser = allCookies(signup);
  assert.match(ownerBrowser, /fja_device=/, 'the browser that signed up is trusted');

  // 20 guesses in parallel: the count is taken before each check, so only 6 are ever evaluated.
  const attacker = { ip: '10.6.6.6' };
  const guesses = await Promise.all(Array.from({ length: 20 }, () => call(api, 'POST', '/auth/signin', { email: 'owner@example.com', password: 'attacker guess' }, attacker)));
  assert.equal(guesses.filter((r) => r.status === 401).length, 6);
  assert.equal(guesses.filter((r) => r.status === 429).length, 14);
  const blocked = await call(api, 'POST', '/auth/signin', { email: 'owner@example.com', password: 'owner pass phrase' });
  assert.equal(blocked.status, 429, 'new browsers wait, even with the right password');
  assert.match(blocked.body.error, /reset your password/);

  const owner = await call(api, 'POST', '/auth/signin', { email: 'owner@example.com', password: 'owner pass phrase' }, { headers: { cookie: ownerBrowser } });
  assert.equal(owner.status, 200, 'the owner’s own browser is not locked out');
  // A made-up device cookie does not help the attacker.
  const forged = await call(api, 'POST', '/auth/signin', { email: 'owner@example.com', password: 'attacker guess' }, { ip: '10.7.7.7', headers: { cookie: 'fja_device=made-up' } });
  assert.equal(forged.status, 429);
});

test('lockout: a password reset (proof of owning the inbox) unlocks sign-in right away', async () => {
  const { api, logs } = await setup();
  await call(api, 'POST', '/auth/signup', { email: 'locked@example.com', password: 'owner pass phrase' });
  for (let i = 0; i < 7; i++) await call(api, 'POST', '/auth/signin', { email: 'locked@example.com', password: 'attacker guess' });
  await call(api, 'POST', '/auth/forgot', { email: 'locked@example.com' });
  const token = logs.join('\n').match(/reset-password\?token=([\w-]+)/)[1];
  assert.equal((await call(api, 'POST', '/auth/reset', { token, password: 'brand new phrase' })).status, 200);
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'locked@example.com', password: 'brand new phrase' })).status, 200);
});

test('enumeration: sign-up, sign-in and reset answer the same for registered and unknown emails', async () => {
  const { api, db, logs } = await setup({ EMAIL_VERIFICATION: 'true' });
  await call(api, 'POST', '/auth/signup', { email: 'taken@example.com', password: 'first pass phrase' });
  await call(api, 'POST', '/auth/verify', { token: lastLink(logs), password: 'first pass phrase' });
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM users')).n, 1);

  const existing = await call(api, 'POST', '/auth/signup', { email: 'taken@example.com', password: 'other pass phrase' });
  const fresh = await call(api, 'POST', '/auth/signup', { email: 'free@example.com', password: 'other pass phrase' });
  assert.equal(existing.status, 202);
  assert.deepEqual(existing.body, fresh.body);
  assert.equal(existing.headers['set-cookie'], undefined);
  assert.equal(fresh.headers['set-cookie'], undefined, 'no session before the email is confirmed');
  assert.match(logs.join('\n'), /already have one/, 'the owner is told by email instead');

  // Signing up with a known email and then signing in with that password reveals nothing either.
  const a = await call(api, 'POST', '/auth/signin', { email: 'taken@example.com', password: 'other pass phrase' });
  const b = await call(api, 'POST', '/auth/signin', { email: 'free@example.com', password: 'other pass phrase' });
  assert.deepEqual([a.status, a.body], [b.status, b.body]);
  assert.equal(a.status, 401);

  const r1 = await call(api, 'POST', '/auth/forgot', { email: 'taken@example.com' });
  const r2 = await call(api, 'POST', '/auth/forgot', { email: 'nobody@example.com' });
  assert.deepEqual([r1.status, r1.body], [r2.status, r2.body]);
});

test('email verification: single-use, expiring, needs the original password, and nothing exists before it', async () => {
  const { api, db, logs } = await setup({ EMAIL_VERIFICATION: 'true' });
  await call(api, 'POST', '/auth/signup', { email: 'Verify@Example.com', password: 'chosen pass phrase' });
  const token = lastLink(logs);
  assert.ok(token);
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM users')).n, 0, 'no account (and no AI) before confirmation');
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM email_verifications WHERE token_hash = $1', [token])).n, 0, 'only the hash is stored');

  // Someone who only has the link (e.g. a stranger signed up with this address) can't finish it.
  const noPassword = await call(api, 'POST', '/auth/verify', { token, password: 'stranger phrase' });
  assert.equal(noPassword.status, 400);
  assert.equal(noPassword.body.code, 'invalid_credentials');

  const ok = await call(api, 'POST', '/auth/verify', { token, password: 'chosen pass phrase' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.email, 'verify@example.com');
  assert.equal((await call(api, 'GET', '/auth/me', undefined, { headers: { cookie: cookieFrom(ok) } })).body.user.email, 'verify@example.com');
  assert.equal((await call(api, 'POST', '/auth/verify', { token, password: 'chosen pass phrase' })).body.code, 'invalid_token', 'single use');

  // Expired links and too many wrong passwords end a link.
  await call(api, 'POST', '/auth/signup', { email: 'late@example.com', password: 'chosen pass phrase' });
  const late = lastLink(logs);
  await db.run("UPDATE email_verifications SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal((await call(api, 'POST', '/auth/verify', { token: late, password: 'chosen pass phrase' })).body.code, 'invalid_token');
  await call(api, 'POST', '/auth/signup', { email: 'guess@example.com', password: 'chosen pass phrase' });
  const guessed = lastLink(logs);
  for (let i = 0; i < 5; i++) await call(api, 'POST', '/auth/verify', { token: guessed, password: `wrong ${i} phrase` });
  assert.equal((await call(api, 'POST', '/auth/verify', { token: guessed, password: 'chosen pass phrase' })).body.code, 'invalid_token');
});

test('sessions: end after 7 idle days; use keeps them alive; password change and sign-out revoke the right ones', async () => {
  const { api, db } = await setup();
  const a = cookieFrom(await call(api, 'POST', '/auth/signup', { email: 's@example.com', password: 'first pass phrase' }));
  const b = cookieFrom(await call(api, 'POST', '/auth/signin', { email: 's@example.com', password: 'first pass phrase' }));
  const me = async (cookie) => (await call(api, 'GET', '/auth/me', undefined, { headers: { cookie } })).body.user;

  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  await db.run('UPDATE sessions SET last_seen_at = $1', [daysAgo(6)]);
  assert.ok(await me(a), 'used 6 days ago: still signed in');
  assert.ok(Date.parse((await db.one('SELECT last_seen_at FROM sessions ORDER BY last_seen_at DESC LIMIT 1')).last_seen_at) > Date.now() - 60000, 'use is recorded');
  await db.run('UPDATE sessions SET last_seen_at = $1', [daysAgo(8)]);
  assert.equal(await me(a), null, 'unused for 8 days: signed out');

  const c = cookieFrom(await call(api, 'POST', '/auth/signin', { email: 's@example.com', password: 'first pass phrase' }));
  const d = cookieFrom(await call(api, 'POST', '/auth/signin', { email: 's@example.com', password: 'first pass phrase' }));
  assert.equal((await call(api, 'POST', '/auth/change-password', { currentPassword: 'first pass phrase', newPassword: 'second pass phrase' }, { headers: { cookie: c } })).status, 200);
  assert.ok(await me(c), 'the device that changed the password stays signed in');
  assert.equal(await me(d), null, 'every other session ends');
  assert.equal(await me(b), null);
  await call(api, 'POST', '/auth/signout', {}, { headers: { cookie: c } });
  assert.equal(await me(c), null, 'sign-out ends it on the server');
});

test('AI fairness: new accounts share their own daily pool; established and parallel requests stay within limits', async () => {
  const { api, db } = await setup({ AI_NEW_ACCOUNT_DAILY_TOTAL: '1', AI_FREE_MONTHLY_LIMIT: '2' });
  const signUp = async (email) => cookieFrom(await call(api, 'POST', '/auth/signup', { email, password: 'a long pass phrase' }));
  const veteran = await signUp('veteran@example.com');
  await db.run('UPDATE users SET created_at = $1 WHERE email = $2', [new Date(Date.now() - 30 * 86400000).toISOString(), 'veteran@example.com']);
  const farm = [await signUp('farm1@example.com'), await signUp('farm2@example.com')];
  const ai = (cookie) => call(api, 'POST', '/ai/summary', { resumeText: 'Cashier for two years', targetRole: 'Office assistant' }, { headers: { cookie } });

  await withFetch(async () => claudeReply(SUMMARY), async () => {
    assert.equal((await ai(farm[0])).status, 200);
    const blocked = await ai(farm[1]);
    assert.equal(blocked.status, 429, 'the new-account pool for today is used up');
    assert.match(blocked.body.error, /new accounts/);
    assert.equal((await call(api, 'GET', '/usage', undefined, { headers: { cookie: farm[1] } })).body.ai.used, 0, 'refused requests are not counted');
    assert.equal((await ai(veteran)).status, 200, 'established users are not affected');

    // Parallel requests can't go over the monthly allowance (the veteran has 1 of 2 left).
    const burst = await Promise.all(Array.from({ length: 6 }, () => ai(veteran)));
    assert.equal(burst.filter((r) => r.status === 200).length, 1);
    assert.equal((await call(api, 'GET', '/usage', undefined, { headers: { cookie: veteran } })).body.ai.used, 2);
  });
});

test('information: in production, AI and job-search setup details stay in the server log', async () => {
  const { api } = await setup({ NODE_ENV: 'production', EMAIL_VERIFICATION: 'false', JSEARCH_API_KEY: 'k', JSEARCH_MONTHLY_LIMIT: '100' });
  const cookie = cookieFrom(await call(api, 'POST', '/auth/signup', { email: 'p@example.com', password: 'a long pass phrase' }));
  const errors = [];
  const originalError = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    const res = await withFetch(
      async () => jsonResponse({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key org-12345' } }, 401),
      () => call(api, 'POST', '/ai/summary', { resumeText: 'Cashier', targetRole: 'Clerk' }, { headers: { cookie } }),
    );
    assert.equal(res.status, 502);
    assert.doesNotMatch(JSON.stringify(res.body), /ANTHROPIC|\.env|org-12345|x-api-key/);
    assert.match(errors.join('\n'), /invalid_key/, 'the owner still sees the cause in the log');
    const status = await withFetch(async () => jsonResponse({}, 401), () => call(api, 'GET', '/ai/status'));
    assert.doesNotMatch(JSON.stringify(status.body), /\.env|ANTHROPIC/);
  } finally {
    console.error = originalError;
  }
  const jobs = (await call(api, 'GET', '/jobs/status')).body;
  assert.deepEqual(Object.keys(jobs).sort(), ['configured', 'country'], 'no provider, quota or usage counts in public');
});

test('proxy diagnostics: DEBUG_PROXY_HEADERS logs the forwarding headers of 20 requests only', async () => {
  const { api, logs } = await setup({ DEBUG_PROXY_HEADERS: 'true', TRUST_PROXY: 'true' });
  for (let i = 0; i < 25; i++) await call(api, 'GET', '/config', undefined, { headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' } });
  const lines = logs.filter((l) => l.startsWith('[proxy]'));
  assert.equal(lines.length, 20);
  assert.match(lines[0], /x-forwarded-for="1\.1\.1\.1, 203\.0\.113\.9".*visitor=1\.1\.1\.1 peer=203\.0\.113\.9/);
  const { logs: quiet, api: off } = await setup();
  await call(off, 'GET', '/config');
  assert.ok(!quiet.some((l) => l.startsWith('[proxy]')), 'off by default');
});

// ---------- Final review: trusted devices, email verification, rate-limit storage, diagnostics ----------

test('trusted device: random, stored hashed, secure cookie, never signs anyone in, bound to one account', async () => {
  const { api, db } = await setup({ NODE_ENV: 'production', EMAIL_VERIFICATION: 'false' });
  const res = await call(api, 'POST', '/auth/signup', { email: 'dev@example.com', password: 'owner pass phrase' });
  const cookie = [].concat(res.headers['set-cookie']).find((c) => c.startsWith('fja_device='));
  assert.match(cookie, /^fja_device=[\w-]{43}; Path=\/; SameSite=Lax; Max-Age=15552000; HttpOnly; Secure$/);
  const token = cookie.split(';')[0].split('=')[1];
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM trusted_devices WHERE token_hash = $1', [token])).n, 0, 'only the hash is stored');

  // The device cookie alone is not a session.
  const deviceOnly = { headers: { cookie: `fja_device=${token}` } };
  assert.equal((await call(api, 'GET', '/auth/me', undefined, deviceOnly)).body.user, null);
  assert.equal((await call(api, 'GET', '/data', undefined, deviceOnly)).status, 401);
  // It still needs the right password.
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'dev@example.com', password: 'wrong guess here' }, deviceOnly)).status, 401);

  // It only counts for the account it was made for: on another account it is a stranger's browser.
  await call(api, 'POST', '/auth/signup', { email: 'other@example.com', password: 'other pass phrase' });
  for (let i = 0; i < 6; i++) await call(api, 'POST', '/auth/signin', { email: 'other@example.com', password: 'wrong guess here' }, { ip: '10.1.1.1' });
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'other@example.com', password: 'other pass phrase' }, deviceOnly)).status, 429);
});

test('trusted device: revoked by password change and reset, expires, and at most 10 are kept per account', async () => {
  const { api, db, logs } = await setup();
  const first = await call(api, 'POST', '/auth/signup', { email: 'rev@example.com', password: 'owner pass phrase' });
  const oldDevice = allCookies(first).match(/fja_device=[\w-]+/)[0];
  const lockOut = async () => {
    for (let i = 0; i < 6; i++) await call(api, 'POST', '/auth/signin', { email: 'rev@example.com', password: 'attacker guess' }, { ip: '10.2.2.2' });
  };
  const withOldDevice = (password) => call(api, 'POST', '/auth/signin', { email: 'rev@example.com', password }, { headers: { cookie: oldDevice } });

  // Password change: other browsers lose their trusted status.
  const session = cookieFrom(first);
  await call(api, 'POST', '/auth/change-password', { currentPassword: 'owner pass phrase', newPassword: 'second pass phrase' }, { headers: { cookie: `${session}; ${oldDevice}` } });
  const kept = await db.one('SELECT COUNT(*)::int AS n FROM trusted_devices');
  assert.equal(kept.n, 1, 'only the browser that changed the password is trusted again');
  await lockOut();
  assert.equal((await withOldDevice('second pass phrase')).status, 429, 'the revoked device no longer skips the lock');

  // Password reset: every device is revoked.
  const beforeReset = (await db.all('SELECT token_hash FROM trusted_devices')).map((r) => r.token_hash);
  await call(api, 'POST', '/auth/forgot', { email: 'rev@example.com' });
  await call(api, 'POST', '/auth/reset', { token: logs.join('\n').match(/reset-password\?token=([\w-]+)/)[1], password: 'third pass phrase' });
  const afterReset = (await db.all('SELECT token_hash FROM trusted_devices')).map((r) => r.token_hash);
  assert.equal(afterReset.length, 1, 'only the browser that did the reset is trusted');
  assert.ok(!beforeReset.includes(afterReset[0]), 'with a new token; every earlier device is revoked');

  // Expired devices are not trusted; and sign-ins without the cookie can't grow the table past 10.
  for (let i = 0; i < 14; i++) await call(api, 'POST', '/auth/signin', { email: 'rev@example.com', password: 'third pass phrase' }, { ip: `10.3.3.${i}` });
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM trusted_devices')).n, 10);
  await db.run("UPDATE trusted_devices SET expires_at = '2000-01-01T00:00:00.000Z'");
  const latest = await call(api, 'POST', '/auth/signin', { email: 'rev@example.com', password: 'third pass phrase' }, { ip: '10.4.4.4' });
  const device = allCookies(latest).match(/fja_device=[\w-]+/)[0];
  await db.run("UPDATE trusted_devices SET expires_at = '2000-01-01T00:00:00.000Z'");
  await lockOut();
  assert.equal((await call(api, 'POST', '/auth/signin', { email: 'rev@example.com', password: 'third pass phrase' }, { headers: { cookie: device } })).status, 429, 'expired: treated as a stranger');
});

test('verification: two clicks at once, two pending sign-ups and duplicates create exactly one account', async () => {
  const { api, db, logs } = await setup({ EMAIL_VERIFICATION: 'true' });
  await call(api, 'POST', '/auth/signup', { email: 'race@example.com', password: 'chosen pass phrase' });
  const first = lastLink(logs);
  await call(api, 'POST', '/auth/signup', { email: 'race@example.com', password: 'chosen pass phrase' });
  const second = lastLink(logs);
  assert.notEqual(first, second);

  const same = await Promise.all([1, 2, 3].map(() => call(api, 'POST', '/auth/verify', { token: first, password: 'chosen pass phrase' })));
  assert.equal(same.filter((r) => r.status === 201).length, 1, 'one click wins');
  assert.ok(same.filter((r) => r.status !== 201).every((r) => [400, 409].includes(r.status)));
  const other = await call(api, 'POST', '/auth/verify', { token: second, password: 'chosen pass phrase' });
  assert.ok([400, 409].includes(other.status), 'the other pending link cannot make a second account');
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM users')).n, 1);
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM email_verifications')).n, 0, 'pending links are removed');
  for (const bad of ['', 'x'.repeat(500), 'not-a-real-token', { $ne: null }]) {
    assert.equal((await call(api, 'POST', '/auth/verify', { token: bad, password: 'chosen pass phrase' })).body.code, 'invalid_token');
  }
});

test('verification: email failures change nothing visible; the password is never in links, logs or plain text', async () => {
  const db = await openDatabase(':memory:');
  const logs = [];
  const log = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const env = { EMAIL_VERIFICATION: 'true', APP_URL: 'https://app.example.com', RESEND_API_KEY: 're_test', EMAIL_FROM: 'First Job AI <no-reply@example.com>' };
  const api = createApi(env, { db, log });
  const password = 'Very-Secret pass 123';
  const sent = [];
  const signup = (email, ok) =>
    withFetch(
      async (url, opts) => (sent.push(opts.body), ok ? jsonResponse({ id: 'email_1' }) : jsonResponse({ name: 'internal_server_error', message: 'boom' }, 500)),
      async () => {
        const r = await call(api, 'POST', '/auth/signup', { email, password });
        await api.settled();
        return r;
      },
    );
  const good = await signup('good@example.com', true);
  const failed = await signup('fail@example.com', false);
  assert.deepEqual([failed.status, failed.body], [good.status, good.body], 'a delivery failure looks the same to the visitor');
  assert.match(logs.join('\n'), /Could not send an email: Resend returned status 500/);

  const everything = [...logs, ...sent].join('\n');
  assert.ok(!everything.includes(password), 'not in any email or log line');
  const link = JSON.parse(sent[0]).text.match(/https:\/\/app\.example\.com\/verify-email\?token=[\w-]+/)[0];
  assert.equal(new URL(link).searchParams.size, 1, 'the link carries only the token');
  assert.ok(!logs.some((l) => l.includes(link.split('=')[1])), 'tokens are not logged');
  for (const row of await db.all('SELECT * FROM email_verifications')) {
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!JSON.stringify(row).includes(password));
  }
});

test('rate-limit storage: forged-address floods add bounded rows, blocked keys skip the database, cleanup is safe', async () => {
  const { api, db } = await setup({ TRUST_PROXY: 'true' });
  for (let i = 0; i < 200; i++) {
    await call(api, 'POST', '/auth/forgot', { email: `v${i}@example.com` }, { ip: '10.0.0.9', headers: { 'x-forwarded-for': `9.${i % 250}.${i}.1, 203.0.113.9` } });
  }
  const rows = (await db.one("SELECT COUNT(*)::int AS n FROM rate_limits WHERE key LIKE 'forgotIp%'")).n;
  assert.ok(rows <= 51, `made-up addresses stop adding rows once the real sender is blocked (${rows} rows)`);

  // Once a key is over its limit, repeats are refused without a database query.
  let queries = 0;
  const counted = { ...db, one: (...a) => ((queries += 1), db.one(...a)), run: (...a) => ((queries += 1), db.run(...a)) };
  const limits = createLimits(counted);
  const rule = { limit: 1, windowMs: 60000 };
  await limits.take('k', rule);
  await limits.take('k', rule);
  const before = queries;
  for (let i = 0; i < 100; i++) assert.equal((await limits.take('k', rule)).ok, false);
  assert.equal(queries, before, 'no queries while blocked');
  await limits.clear('k');
  assert.equal((await limits.take('k', rule)).ok, true, 'clear() lifts the block at once');

  // Old rows are removed, and a failing cleanup never fails the request.
  await db.run("INSERT INTO rate_limits (key, window_start, count) VALUES ('old', 0, 1)");
  await createLimits(db).take('trigger', rule);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await db.one("SELECT 1 AS x FROM rate_limits WHERE key = 'old'"), null);
  const broken = createLimits({ ...db, run: async () => { throw new Error('cleanup down'); } });
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal((await broken.take('fine', rule)).ok, true);
  } finally {
    console.error = origError;
  }
});

test('proxy diagnostics never log cookies, Authorization, the URL or the body; credential headers are never trusted', async () => {
  const { api, logs } = await setup({ DEBUG_PROXY_HEADERS: 'true', TRUST_PROXY: 'true', CLIENT_IP_HEADER: 'cookie' });
  await call(api, 'POST', '/auth/signin?token=URLSECRET', { email: 'a@b.co', password: 'BODYSECRET pass' }, {
    headers: { cookie: 'fja_session=COOKIESECRET; fja_device=DEVICESECRET', authorization: 'Bearer AUTHSECRET', 'x-forwarded-for': '1.1.1.1, 203.0.113.9' },
  });
  await call(api, 'GET', '/config', undefined, { headers: { 'x-forwarded-for': 'fja_session=abc\n[auth] fake line' } });
  const proxyLines = logs.filter((l) => l.startsWith('[proxy]')).join('\n');
  assert.equal(logs.filter((l) => l.startsWith('[proxy]')).length, 2);
  for (const secret of ['COOKIESECRET', 'DEVICESECRET', 'AUTHSECRET', 'URLSECRET', 'BODYSECRET']) assert.ok(!proxyLines.includes(secret), secret);
  assert.ok(!proxyLines.includes('\n[auth] fake line'), 'header values are escaped, so they cannot forge log lines');
  assert.match(proxyLines, /visitor="\(not an IP address\)"/);
  for (const name of ['cookie', 'authorization', 'x-api-key', 'x-auth-token', 'stripe-signature']) assert.equal(proxySettings({ CLIENT_IP_HEADER: name }).header, '', name);
  assert.equal(proxySettings({ CLIENT_IP_HEADER: 'x-vercel-forwarded-for' }).header, 'x-vercel-forwarded-for');
});
