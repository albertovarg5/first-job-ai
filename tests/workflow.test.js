// The guided application workflow, the job analysis AI task and the monthly
// AI allowance per plan. Anthropic is always mocked; no real key is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiHandler } from '../server/aiHandler.js';
import { createApi } from '../server/api.js';
import { openDatabase } from '../server/db.js';
import { limitReachedMessage, nextResetDate, planLimits } from '../server/plans.js';
import { emptyResume } from '../src/lib/resume.js';
import { applicationSteps, applicationsNeedingAction, basicAnalysis, nextStep, stepProgress, verifyAnalysis } from '../src/lib/workflow.js';
import { call, jsonResponse, withFetch } from './helpers.js';

const quietLog = { info() {}, warn() {}, error() {} };
const cookieFrom = (res) => String(res.headers['set-cookie'] || '').split(';')[0];
const claudeReply = (obj) => jsonResponse({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' });
const SUMMARY = { summary: 'Business student with two years of cashier experience seeking an office assistant role.' };

const DESCRIPTION =
  'We are hiring a Junior Data Analyst. Required: SQL and Excel. A bachelor’s degree in a related field. Nice to have: Tableau. You will build weekly reports for the sales team.';

// ---------- Workflow steps ----------

const app = (over = {}) => ({ id: 'a1', title: 'Analyst', company: 'Northwind', status: 'interested', description: '', updatedAt: '2026-10-01', ...over });

test('workflow: steps come from real data and the next step is the first unfinished one', () => {
  const empty = app();
  assert.equal(nextStep(empty, {}).id, 'details', 'without a description, adding it comes first');
  assert.deepEqual(stepProgress(empty, {}), { done: 0, total: 6, percent: 0 });

  const ready = app({ description: DESCRIPTION, analysis: { at: 'x' }, tailoredAt: 'x' });
  assert.equal(nextStep(ready, {}).id, 'letter');
  const data = { coverLetters: [{ id: 'c', applicationId: 'a1' }, { id: 'other', applicationId: 'zzz' }], interviewSessions: [] };
  assert.equal(nextStep(ready, data).id, 'apply', 'a letter for this application completes the letter step');
  assert.equal(nextStep({ ...ready, status: 'applied' }, data).id, 'interview');
  const done = { ...data, interviewSessions: [{ id: 's', applicationId: 'a1' }] };
  assert.equal(nextStep({ ...ready, status: 'interview' }, done), null);
  assert.equal(stepProgress({ ...ready, status: 'interview' }, done).percent, 100);

  // Letters and practice for another job never count.
  assert.equal(applicationSteps(app({ id: 'zzz-other' }), data).find((s) => s.id === 'letter').done, false);
  // Deep links point at this application.
  assert.equal(applicationSteps(ready, {}).find((s) => s.id === 'letter').to, '/cover-letters?job=a1');
  assert.equal(nextStep(app({ status: 'rejected' }), {}), null, 'closed applications have no next step');
});

test('workflow: dashboard lists open applications that need action, newest first', () => {
  const data = {
    applications: [
      app({ id: 'old', updatedAt: '2026-01-01' }),
      app({ id: 'new', updatedAt: '2026-10-20' }),
      app({ id: 'offer', status: 'offer', updatedAt: '2026-10-21' }),
      app({ id: 'gone', status: 'rejected', updatedAt: '2026-10-22' }),
    ],
  };
  const list = applicationsNeedingAction(data, 3);
  assert.deepEqual(list.map((x) => x.app.id), ['new', 'old']);
  assert.equal(list[0].step.id, 'details');
  assert.equal(list[0].progress.total, 6);
});

// ---------- Job analysis ----------

test('analysis: AI quotes that are not in the resume are removed', () => {
  const resumeText = 'Built weekly sales reports in Excel for a student club of 40 members.';
  const result = verifyAnalysis(
    {
      summary: 'Entry-level reporting role.',
      mustHave: [
        { requirement: 'Excel', evidence: 'Built weekly sales reports in Excel' },
        { requirement: 'SQL', evidence: 'Wrote SQL queries for the finance team' }, // invented
        { requirement: '', evidence: '' },
      ],
      niceToHave: 'not a list',
      responsibilities: ['Build weekly reports', 42, ''],
      keywords: ['SQL', 'Excel'],
    },
    resumeText,
  );
  assert.equal(result.mustHave.length, 2);
  assert.deepEqual(result.mustHave[0], { requirement: 'Excel', evidence: 'Built weekly sales reports in Excel', shown: true });
  assert.deepEqual(result.mustHave[1], { requirement: 'SQL', evidence: '', shown: false });
  assert.deepEqual(result.niceToHave, []);
  assert.deepEqual(result.responsibilities, ['Build weekly reports', '42']);
  assert.deepEqual(result.questionsToAsk, []);
});

test('analysis: Basic mode only marks skills that are on the resume', () => {
  const resume = { ...emptyResume(), skills: ['Excel'], contact: { ...emptyResume().contact, fullName: 'Sam' } };
  const result = basicAnalysis(resume, DESCRIPTION);
  const byName = Object.fromEntries(result.mustHave.map((r) => [r.requirement, r.shown]));
  assert.equal(byName.Excel, true);
  assert.equal(byName.SQL, false);
  assert.ok(result.mustHave.some((r) => /bachelor/i.test(r.requirement)), 'degree requirement is listed');
  assert.ok(result.mustHave.every((r) => r.evidence === ''), 'Basic mode never writes resume quotes');
  assert.equal(basicAnalysis(emptyResume(), DESCRIPTION).mustHave.some((r) => r.shown), false, 'an empty resume shows nothing');
});

test('AI analyze route: refuses to analyze without a job description, validates output', async () => {
  const handler = createAiHandler({ ANTHROPIC_API_KEY: 'sk-ant-test' });
  let calls = 0;
  let sent;
  const reply = {
    summary: 'Junior analyst building sales reports.',
    mustHave: [{ requirement: 'SQL', evidence: '' }],
    niceToHave: [{ requirement: 'Tableau', evidence: '' }],
    responsibilities: ['Build weekly reports'],
    keywords: ['SQL'],
    questionsToAsk: ['Which tools does the team use?'],
  };
  await withFetch(
    async (url, init) => {
      calls += 1;
      sent = JSON.parse(init.body);
      return claudeReply(reply);
    },
    async () => {
      const missing = await call(handler, 'POST', '/analyze', { jobTitle: 'Analyst', jobDescription: 'Short' });
      assert.equal(missing.status, 400);
      assert.equal(missing.body.code, 'invalid_input');
      assert.equal(calls, 0, 'the API is not called for a job it has not seen');

      const ok = await call(handler, 'POST', '/analyze', { jobTitle: 'Analyst', company: 'Northwind', jobDescription: DESCRIPTION, resumeText: '' });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.mustHave[0].requirement, 'SQL');
      assert.match(sent.messages[0].content, /bachelor’s degree/);
      assert.match(sent.messages[0].content, /No resume provided/);
      assert.match(sent.system, /Only list requirements/);
    },
  );
  await withFetch(
    async () => claudeReply({ summary: 'x', mustHave: 'nope' }),
    async () => {
      const bad = await call(handler, 'POST', '/analyze', { jobDescription: DESCRIPTION });
      assert.equal(bad.status, 502);
      assert.equal(bad.body.code, 'bad_response');
    },
  );
});

// ---------- Plans and AI allowance ----------

test('plans: limits come from the environment with safe defaults', () => {
  assert.deepEqual(planLimits({}), { free: 30, premium: 300 });
  assert.deepEqual(planLimits({ AI_FREE_MONTHLY_LIMIT: '5', AI_PREMIUM_MONTHLY_LIMIT: '0' }), { free: 5, premium: 0 });
  assert.deepEqual(planLimits({ AI_FREE_MONTHLY_LIMIT: 'lots', AI_PREMIUM_MONTHLY_LIMIT: '-1' }), { free: 30, premium: 300 });
  assert.equal(nextResetDate(new Date('2026-12-15T12:00:00Z')), '2027-01-01');
  assert.match(limitReachedMessage({ limit: 30, planLabel: 'Free', resetsOn: '2026-11-01' }), /30 AI requests.*Free plan.*2026-11-01/);
});

test('AI allowance: counted per user, refunded on failure, blocked at the limit, higher on premium', async () => {
  const db = await openDatabase(':memory:');
  const api = createApi({ ANTHROPIC_API_KEY: 'sk-ant-test', AI_FREE_MONTHLY_LIMIT: '2', AI_PREMIUM_MONTHLY_LIMIT: '3' }, { db, log: quietLog });
  const alice = cookieFrom(await call(api, 'POST', '/auth/signup', { email: 'alice@example.com', password: 'alice long phrase' }));
  const bob = cookieFrom(await call(api, 'POST', '/auth/signup', { email: 'bob@example.com', password: 'bob long phrase' }, { ip: '10.0.0.2' }));
  const ai = (cookie) => call(api, 'POST', '/ai/summary', { resumeText: 'Cashier for two years', targetRole: 'Office assistant' }, { headers: { cookie } });
  const usage = async (cookie) => (await call(api, 'GET', '/usage', undefined, { headers: { cookie } })).body;

  // Guests get no usage record.
  assert.deepEqual(await call(api, 'GET', '/usage').then((r) => r.body), { signedIn: false, ai: null });

  // A failed AI call is not counted.
  await withFetch(
    async () => jsonResponse({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 500),
    async () => assert.equal((await ai(alice)).status, 502),
  );
  assert.equal((await usage(alice)).ai.used, 0);

  await withFetch(
    async () => claudeReply(SUMMARY),
    async () => {
      assert.equal((await ai(alice)).status, 200);
      assert.equal((await ai(alice)).status, 200);
      const blocked = await ai(alice);
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.code, 'ai_limit_reached');
      assert.match(blocked.body.error, /2 AI requests included in the Free plan/);
      assert.equal(blocked.body.usage.used, 2);

      // Bob has his own allowance.
      assert.equal((await ai(bob)).status, 200);
      assert.equal((await usage(bob)).ai.used, 1);

      // GET /ai/status is free.
      await call(api, 'GET', '/ai/status', undefined, { headers: { cookie: alice } });
      const u = await usage(alice);
      assert.equal(u.signedIn, true);
      assert.deepEqual({ plan: u.ai.plan, used: u.ai.used, limit: u.ai.limit }, { plan: 'free', used: 2, limit: 2 });

      // What a future billing webhook would do: switch the plan.
      db.prepare("UPDATE users SET plan = 'premium' WHERE email = 'alice@example.com'").run();
      assert.equal((await ai(alice)).status, 200);
      assert.equal((await ai(alice)).status, 403);
      assert.equal((await usage(alice)).ai.planLabel, 'Premium');
    },
  );
  db.close();
});
