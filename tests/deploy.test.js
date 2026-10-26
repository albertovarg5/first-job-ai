import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApi } from '../server/api.js';
import { checkConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { httpsRedirect } from '../server/http.js';
import { call, jsonResponse, withFetch } from './helpers.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const BACKEND = 'https://first-job-ai-production.up.railway.app';

test('Vercel builds and serves the frontend and forwards only /api and /healthz to the one Railway backend', () => {
  const vercel = read('vercel.json');
  assert.equal(vercel.buildCommand, 'npm run build');
  assert.equal(vercel.outputDirectory, 'dist');
  const [api, health, spa, ...rest] = vercel.rewrites;
  assert.deepEqual(api, { source: '/api/:path*', destination: `${BACKEND}/api/:path*` });
  assert.deepEqual(health, { source: '/healthz', destination: `${BACKEND}/healthz` });
  // Last: every other path loads the app, except API calls and built files.
  assert.deepEqual(spa, { source: '/((?!api/|assets/).*)', destination: '/index.html' });
  assert.equal(rest.length, 0);
  const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /connect-src 'self'/, 'the browser only talks to its own site; Vercel forwards /api');
  assert.match(csp, /script-src 'self'/);
});

test('Railway runs the API only, starts with npm start and is health-checked on /healthz', () => {
  const railway = read('railway.json');
  assert.doesNotMatch(railway.build.buildCommand, /vite|npm run build/, 'the frontend is built by Vercel, not Railway');
  assert.equal(railway.deploy.startCommand, 'npm start');
  assert.equal(railway.deploy.healthcheckPath, '/healthz');
  assert.match(read('package.json').scripts.start, /node .*server\/index\.js/);
});

test('production startup lists every missing variable by name and never prints secret values', () => {
  const bare = checkConfig({ NODE_ENV: 'production', APP_URL: 'https://site.example', DATABASE_URL: 'postgresql://u:p@h:5432/d' });
  const all = bare.warnings.join('\n');
  assert.match(all, /ANTHROPIC_API_KEY is not set/);
  assert.match(all, /JSEARCH_API_KEY is not set/);
  assert.match(all, /Premium billing is off until these are set: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY\./);
  assert.match(all, /RESEND_API_KEY \/ EMAIL_FROM are not both set/);
  assert.deepEqual(bare.features, { ai: false, jobs: false, email: false, billing: false });
  assert.equal(bare.errors.length, 0, 'optional features never stop the server');

  const partial = checkConfig({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_TOPSECRET123', STRIPE_PRICE_MONTHLY: 'prod_wrong' });
  const msg = partial.warnings.join('\n');
  assert.match(msg, /until these are set: STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY\./, 'an invalid price counts as missing');
  assert.ok(!msg.includes('TOPSECRET'), 'secret values never appear');

  const ready = checkConfig({ NODE_ENV: 'production', APP_URL: 'https://site.example', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_MONTHLY: 'price_1', STRIPE_ALLOW_LIVE: 'true' });
  assert.equal(ready.features.billing, 'LIVE');
  assert.ok(!ready.warnings.some((w) => w.includes('Premium billing is off')));
});

test('links the server builds (reset email, http→https) ignore spoofed Host and X-Forwarded-Host', async () => {
  const site = 'https://first-job-ai-steel.vercel.app';
  const env = { NODE_ENV: 'production', APP_URL: site, RESEND_API_KEY: 're_test', EMAIL_FROM: 'First Job AI <no-reply@example.com>' };
  const db = await openDatabase(':memory:');
  const api = createApi(env, { db, log: { info() {}, warn() {}, error() {} } });
  const spoofed = { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', origin: site };
  await call(api, 'POST', '/auth/signup', { email: 'owner@example.com', password: 'a long pass phrase' }, { headers: spoofed });
  const sent = [];
  const res = await withFetch(
    async (url, opts) => (sent.push(JSON.parse(opts.body)), jsonResponse({ id: 'email_1' })),
    () => call(api, 'POST', '/auth/forgot', { email: 'owner@example.com' }, { headers: spoofed }),
  );
  assert.equal(res.status, 200);
  assert.match(sent[0].text, /\nhttps:\/\/first-job-ai-steel\.vercel\.app\/reset-password\?token=[\w-]+\n/);
  assert.ok(!sent[0].text.includes('evil.example'));
  // A page on another site calling this backend (the browser sends the real Host) never gets that far.
  const fromEvil = { host: 'first-job-ai-production.up.railway.app', origin: 'https://evil.example' };
  const refused = await withFetch(
    async () => assert.fail('no email may be sent'),
    () => call(api, 'POST', '/auth/forgot', { email: 'owner@example.com' }, { headers: fromEvil }),
  );
  assert.equal(refused.status, 403);

  const plainHttp = { url: '/signin?next=https://evil.example', headers: { host: 'evil.example', 'x-forwarded-proto': 'http' } };
  assert.equal(httpsRedirect(plainHttp, env), `${site}/signin?next=https://evil.example`, 'always to APP_URL, never to the Host header');
});

test('on Railway the server refuses to start without DATABASE_URL, and its output holds no secrets', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../server/index.js', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { PATH: process.env.PATH, NODE_ENV: 'production', RAILWAY_PROJECT_ID: 'p', PORT: '0', STRIPE_SECRET_KEY: 'sk_live_TOPSECRET123', RESEND_API_KEY: 're_TOPSECRET456' },
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 1, out);
  assert.match(out, /DATABASE_URL is not set/);
  assert.match(out, /Fix the settings above/);
  assert.ok(!out.includes('TOPSECRET'), 'secret values never appear in the startup log');
});
