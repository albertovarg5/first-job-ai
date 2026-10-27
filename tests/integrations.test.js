// End-to-end checks for the external integrations and the saved-job flow:
// settings validation, Anthropic error handling, and saved jobs + tracker
// persisting per user in a real SQLite file. No real API is ever called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiHandler } from '../server/aiHandler.js';
import { createApi } from '../server/api.js';
import { checkConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { normalizeJob } from '../server/jobsHandler.js';
import { addSavedJob, jobToApplication } from '../src/lib/jobs.js';
import { call, jsonResponse, withFetch } from './helpers.js';

const quietLog = { info() {}, warn() {}, error() {} };
const cookieFrom = (res) => String(res.headers['set-cookie'] || '').split(';')[0];

// ---------- Settings validation ----------

test('config: empty settings start fine with every optional feature off', () => {
  const r = checkConfig({});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.features, { ai: false, jobs: false, email: false, billing: false });
  assert.ok(r.warnings.some((w) => w.includes('ANTHROPIC_API_KEY')));
  assert.ok(r.warnings.some((w) => w.includes('JSEARCH_API_KEY')));
});

test('config: secrets named VITE_* are errors', () => {
  const r = checkConfig({ VITE_ANTHROPIC_API_KEY: 'sk-ant-x', VITE_JSEARCH_API_KEY: 'k', VITE_APP_NAME: 'ok' });
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /Rename it to ANTHROPIC_API_KEY/);
});

test('config: half-configured or malformed settings are explained', () => {
  const r = checkConfig({
    ANTHROPIC_API_KEY: 'wrong-format',
    JSEARCH_API_KEY: 'k',
    JSEARCH_PROVIDER: 'indeed',
    JSEARCH_MONTHLY_LIMIT: 'lots',
    JSEARCH_COUNTRY: 'zz',
    RESEND_API_KEY: 're_123',
  });
  const all = r.warnings.join('\n');
  assert.match(all, /sk-ant-/);
  assert.match(all, /JSEARCH_PROVIDER "indeed"/);
  assert.match(all, /JSEARCH_MONTHLY_LIMIT "lots"/);
  assert.match(all, /JSEARCH_COUNTRY "zz"/);
  assert.match(all, /only RESEND_API_KEY is set/);
  assert.equal(r.features.email, false);
  assert.equal(r.features.jobs, 'OpenWeb Ninja');
});

test('config: production warns about password reset without APP_URL and email', () => {
  const r = checkConfig({ NODE_ENV: 'production' });
  assert.ok(r.warnings.some((w) => w.includes('APP_URL')));
  const good = checkConfig({ NODE_ENV: 'production', APP_URL: 'https://jobs.example.com', RESEND_API_KEY: 're_1', EMAIL_FROM: 'First Job AI <no-reply@example.com>' });
  assert.ok(!good.warnings.some((w) => /APP_URL|RESEND/.test(w)));
  assert.equal(good.features.email, true);
});

// ---------- Anthropic ----------

async function aiCall(fake, env = {}) {
  let sent;
  const res = await withFetch(
    async (url, opts) => {
      if (String(url).includes('/v1/models')) return new Response('{}', { status: 200 });
      sent = JSON.parse(opts.body);
      return fake();
    },
    () => call(createAiHandler({ ANTHROPIC_API_KEY: 'sk-ant-test', ...env }), 'POST', '/summary', { resumeText: 'Cashier at a cafe', targetRole: 'Barista' }),
  );
  return { res, sent };
}

test('AI: sends AI_MODEL with room for thinking, and ignores thinking blocks in the answer', async () => {
  const summary = 'Entry-level candidate with cafe cashier experience seeking a barista role.';
  const { res, sent } = await aiCall(
    () =>
      jsonResponse({
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: JSON.stringify({ summary }) },
        ],
      }),
    { AI_MODEL: 'claude-opus-5-5' },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.summary, summary);
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.ok(sent.max_tokens >= 16000);
  assert.equal(sent.temperature, undefined);
});

test('AI: API errors become clear messages with codes', async () => {
  const cases = [
    [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 502, 'invalid_key', /ANTHROPIC_API_KEY/],
    [404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-nope' } }, 502, 'bad_model', /AI_MODEL/],
    [429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429, 'rate_limited', /too many/],
    [529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 503, 'overloaded', /busy/],
    [400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, 502, 'no_credit', /credit/],
    [500, { type: 'error', error: { type: 'api_error', message: 'Internal' } }, 502, 'upstream', /Internal/],
  ];
  for (const [upstream, body, status, code, message] of cases) {
    const { res } = await aiCall(() => jsonResponse(body, upstream));
    assert.equal(res.status, status, code);
    assert.equal(res.body.code, code);
    assert.match(res.body.error, message);
    assert.ok(!JSON.stringify(res.body).includes('sk-ant-test'));
  }
});

test('AI: refusals, cut-off answers, bad JSON and network failures are handled', async () => {
  const refusal = await aiCall(() => jsonResponse({ stop_reason: 'refusal', content: [] }));
  assert.equal(refusal.res.body.code, 'refusal');
  const cut = await aiCall(() => jsonResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"summary": "Entry' }] }));
  assert.equal(cut.res.body.code, 'too_long');
  const bad = await aiCall(() => jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{not json}' }] }));
  assert.equal(bad.res.body.code, 'bad_response');
  const net = await aiCall(() => {
    throw new TypeError('fetch failed');
  });
  assert.equal(net.res.body.code, 'network');
  const missing = await call(createAiHandler({}), 'POST', '/summary', { resumeText: 'x' });
  assert.equal(missing.status, 503);
  assert.equal(missing.body.code, 'not_configured');
});

// ---------- Resend ----------

test('password reset email is sent through Resend with the configured sender', async () => {
  const db = await openDatabase(':memory:');
  const logs = [];
  const api = createApi(
    { RESEND_API_KEY: 're_test', EMAIL_FROM: 'First Job AI <no-reply@example.com>', APP_URL: 'https://jobs.example.com' },
    { db, log: { ...quietLog, info: (m) => logs.push(m), error: (m) => logs.push(m) } },
  );
  await call(api, 'POST', '/auth/signup', { email: 'mail@example.com', password: 'a long pass phrase' });
  const sent = [];
  // Emails go out after the response; api.settled() waits for them.
  const forgot = (email) => async () => {
    const r = await call(api, 'POST', '/auth/forgot', { email });
    await api.settled();
    return r;
  };
  const res = await withFetch(
    async (url, opts) => {
      sent.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
      return jsonResponse({ id: 'email_1' });
    },
    forgot('mail@example.com'),
  );
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].headers.Authorization, 'Bearer re_test');
  assert.equal(sent[0].body.from, 'First Job AI <no-reply@example.com>');
  assert.deepEqual(sent[0].body.to, ['mail@example.com']);
  assert.match(sent[0].body.text, /https:\/\/jobs\.example\.com\/reset-password\?token=/);
  // The log names Resend's email id (to look it up in the Resend dashboard), never the address or token.
  assert.deepEqual(logs, ['[auth] Reset request received.', '[auth] Account found: sending the reset email through Resend.', '[auth] Reset email accepted by Resend (email id email_1).']);

  // Unknown emails get the same answer and send nothing.
  const unknown = await withFetch(
    async () => assert.fail('no email for unknown accounts'),
    forgot('nobody@example.com'),
  );
  assert.equal(unknown.body.message, res.body.message);
  assert.match(logs.at(-1), /no account: nothing was sent/);

  // A Resend failure only reaches the server log: an error shown only for existing accounts
  // would tell strangers which emails are registered. This is Resend's answer for
  // onboarding@resend.dev and a recipient other than the account's own email.
  const failed = await withFetch(
    async () => jsonResponse({ name: 'validation_error', message: 'You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain.' }, 403),
    forgot('mail@example.com'),
  );
  assert.equal(failed.status, 200);
  assert.equal(failed.body.message, res.body.message);
  assert.match(logs.at(-1), /Resend returned status 403: validation_error: You can only send testing emails to your own email address \(<address>\)/);
  assert.ok(!logs.join('\n').includes('owner@example.com'), "addresses in Resend's message are masked");
  const token = sent[0].body.text.match(/token=([\w-]+)/)[1];
  for (const line of logs) assert.ok(!line.includes('mail@example.com') && !line.includes(token) && !line.includes('re_test'), 'no address, token or key in the log');
});

// ---------- Saved jobs + tracker persistence ----------

const RAW = {
  job_id: 'own-1',
  job_title: 'Junior Data Analyst',
  employer_name: 'Northwind',
  job_apply_link: 'https://northwind.example/jobs/1',
  job_city: 'Denver',
  job_state: 'CO',
  job_description: 'SQL and Excel reporting.',
};

test('saved jobs and tracker entries persist per user in the database across sign-out, sign-in and restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fja-int-'));
  const file = join(dir, 'app.db');
  try {
    // First server process.
    let db = await openDatabase(file);
    let api = createApi({}, { db, log: quietLog });
    const signup = await call(api, 'POST', '/auth/signup', { email: 'saver@example.com', password: 'save my jobs please' });
    let cookie = cookieFrom(signup);

    // Save a job twice (duplicate) and track it, as the Job Search page does.
    const job = normalizeJob(RAW);
    let savedJobs = addSavedJob([], job, '2026-10-23T10:00:00.000Z');
    savedJobs = addSavedJob(savedJobs, job);
    const tracked = { ...jobToApplication(job), id: 'app-1', status: 'applied', statusHistory: [{ status: 'interested', at: 'a' }, { status: 'applied', at: 'b' }] };
    const put = await call(api, 'PUT', '/data', { baseRevision: 0, data: { savedJobs: [...savedJobs, ...savedJobs], applications: [tracked] } }, { headers: { cookie } });
    assert.equal(put.status, 200);

    // Sign out: the session no longer reads the data.
    await call(api, 'POST', '/auth/signout', {}, { headers: { cookie } });
    assert.equal((await call(api, 'GET', '/data', undefined, { headers: { cookie } })).status, 401);

    // Another user sees nothing.
    const other = cookieFrom(await call(api, 'POST', '/auth/signup', { email: 'other@example.com', password: 'other user phrase' }, { ip: '10.9.9.9' }));
    assert.equal((await call(api, 'GET', '/data', undefined, { headers: { cookie: other } })).body.data, null);
    await db.close();

    // "Restart": new database connection and API on the same file, sign in again.
    db = await openDatabase(file);
    api = createApi({}, { db, log: quietLog });
    const signin = await call(api, 'POST', '/auth/signin', { email: 'saver@example.com', password: 'save my jobs please' });
    assert.equal(signin.status, 200);
    cookie = cookieFrom(signin);
    const got = await call(api, 'GET', '/data', undefined, { headers: { cookie } });
    assert.equal(got.status, 200);
    assert.equal(got.body.data.savedJobs.length, 1, 'duplicate saves are stored once');
    assert.equal(got.body.data.savedJobs[0].job.title, 'Junior Data Analyst');
    assert.equal(got.body.data.savedJobs[0].job.applyLink, 'https://northwind.example/jobs/1');
    assert.equal(got.body.data.applications.length, 1);
    assert.equal(got.body.data.applications[0].status, 'applied');
    assert.equal(got.body.data.applications[0].sourceJobId, 'own-1');
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('job search through the full API: guests allowed in development, sign-in required in production', async () => {
  const fake = async () => jsonResponse({ status: 'OK', data: { jobs: [RAW], cursor: null } });
  const dev = createApi({ JSEARCH_API_KEY: 'own-key' }, { db: await openDatabase(':memory:'), log: quietLog });
  const devRes = await withFetch(fake, () => call(dev, 'GET', '/jobs/search?query=analyst'));
  assert.equal(devRes.status, 200);
  assert.equal(devRes.body.jobs[0].employer, 'Northwind');

  const prodDb = await openDatabase(':memory:');
  const prod = createApi({ NODE_ENV: 'production', EMAIL_VERIFICATION: 'false', JSEARCH_API_KEY: 'own-key' }, { db: prodDb, log: quietLog });
  let calls = 0;
  const guest = await withFetch(
    async () => {
      calls += 1;
      return fake();
    },
    () => call(prod, 'GET', '/jobs/search?query=analyst'),
  );
  assert.equal(guest.status, 401);
  assert.equal(calls, 0, 'the paid API is not called for guests');
  const cookie = cookieFrom(await call(prod, 'POST', '/auth/signup', { email: 'pro@example.com', password: 'production phrase' }));
  const signedIn = await withFetch(fake, () => call(prod, 'GET', '/jobs/search?query=analyst', undefined, { headers: { cookie } }));
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.jobs.length, 1);
});
