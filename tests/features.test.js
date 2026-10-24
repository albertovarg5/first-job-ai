import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyMissions, missionStats } from '../src/lib/missions.js';
import { filterApplications, upcomingInterviews, validateApplication, countByStatus } from '../src/lib/applications.js';
import { buildQuestionSet, fieldForTitle } from '../src/lib/questionBank.js';
import { checkAnswer } from '../src/lib/answerChecklist.js';
import { normalizeData } from '../src/lib/storage.js';
import { createAiHandler, extractJson } from '../server/aiHandler.js';

test('daily missions: three different missions, same for the same day', () => {
  const a = dailyMissions('2026-10-23', {});
  const b = dailyMissions('2026-10-23', {});
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((m) => m.id)).size, 3);
  assert.deepEqual(a.map((m) => m.id), b.map((m) => m.id));
});

test('mission streak counts consecutive days', () => {
  const today = new Date(2026, 9, 23);
  const stats = missionStats({ '2026-10-21': ['a'], '2026-10-22': ['b'], '2026-10-23': ['c', 'd'] }, today);
  assert.equal(stats.streak, 3);
  assert.equal(stats.total, 4);
  assert.equal(stats.last14.length, 14);
  // A streak survives until the end of today even if nothing is done yet today.
  assert.equal(missionStats({ '2026-10-22': ['b'] }, today).streak, 1);
});

const apps = [
  { id: '1', company: 'Nike', title: 'Marketing Intern', status: 'applied', updatedAt: '2026-10-20', interviewDate: '' },
  { id: '2', company: 'Adidas', title: 'Social Media Assistant', status: 'interview', updatedAt: '2026-10-22', interviewDate: '2026-10-27T10:30' },
  { id: '3', company: 'Columbia', title: 'Content Intern', status: 'rejected', updatedAt: '2026-10-21', interviewDate: '2026-10-25T09:00' },
];

test('search and filter applications', () => {
  assert.equal(filterApplications(apps, { query: 'nike' }).length, 1);
  assert.equal(filterApplications(apps, { status: 'interview' })[0].company, 'Adidas');
  assert.deepEqual(filterApplications(apps, { sort: 'company' }).map((a) => a.company), ['Adidas', 'Columbia', 'Nike']);
  assert.equal(countByStatus(apps).applied, 1);
});

test('upcoming interviews skip rejected and past dates', () => {
  const list = upcomingInterviews(apps, new Date(2026, 9, 23));
  assert.equal(list.length, 1);
  assert.equal(list[0].company, 'Adidas');
  assert.equal(list[0].inDays, 4);
});

test('application validation', () => {
  assert.deepEqual(Object.keys(validateApplication({ company: '', title: '' })).sort(), ['company', 'title']);
  assert.ok(validateApplication({ company: 'A', title: 'B', link: 'nike.com' }).link);
  assert.deepEqual(validateApplication({ company: 'A', title: 'B', link: 'https://nike.com' }), {});
});

test('question sets match the job title and type', () => {
  assert.equal(fieldForTitle('Software Engineering Intern'), 'software');
  assert.equal(fieldForTitle('Barista'), 'service');
  const { questions } = buildQuestionSet({ jobTitle: 'Data analyst', type: 'technical', count: 5, seed: 1 });
  assert.equal(questions.length, 5);
  assert.ok(questions.every((q) => q.category === 'technical'));
  const mixed = buildQuestionSet({ jobTitle: 'Nurse', type: 'mixed', count: 5, seed: 2 }).questions;
  assert.equal(mixed[0].question, 'Tell me about yourself.');
});

test('answer checklist recognizes STAR structure', () => {
  const good = checkAnswer({
    question: 'Tell me about a time you worked on a team.',
    category: 'behavioral',
    answer:
      'Last semester in my Marketing 301 class, our team of four had a campaign due. I organized weekly meetings and I wrote the survey. As a result we finished early and I learned how to plan ahead with a team.',
  });
  const short = checkAnswer({ question: 'Tell me about a time you worked on a team.', category: 'behavioral', answer: 'We did it.' });
  assert.equal(good.mode, 'checklist');
  assert.ok(good.passed > short.passed);
  assert.ok(short.checks.find((c) => c.label === 'Length').passed === false);
});

test('saved data from older versions loads safely', () => {
  const data = normalizeData({ profile: { name: 'A' }, resume: { contact: { fullName: 'A' } } });
  assert.equal(data.resume.contact.email, '');
  assert.deepEqual(data.applications, []);
  assert.equal(data.settings.aiEnabled, true);
});

// --- AI server route (no network) ---
function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const listeners = {};
    const req = { method, url, on: (ev, fn) => (listeners[ev] = fn) };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(text) { resolve({ status: this.statusCode, body: JSON.parse(text) }); },
    };
    handler(req, res, () => resolve({ status: 'next' }));
    setImmediate(() => {
      if (body !== undefined) listeners.data?.(JSON.stringify(body));
      listeners.end?.();
    });
  });
}

test('AI route reports not connected without a key, and refuses requests', async () => {
  const handler = createAiHandler({});
  const status = await call(handler, 'GET', '/status');
  assert.equal(status.body.connected, false);
  const res = await call(handler, 'POST', '/translate', { text: 'hi' });
  assert.equal(res.status, 503);
});

test('AI route calls the model with the key server-side and parses JSON', async () => {
  const original = globalThis.fetch;
  let sentHeaders;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/v1/models')) return new Response('{}', { status: 200 });
    sentHeaders = opts.headers;
    const text = '```json\n{"bullets":["Developed a website."]}\n```';
    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
  };
  try {
    const handler = createAiHandler({ ANTHROPIC_API_KEY: 'sk-test', AI_MODEL: 'test-model' });
    const status = await call(handler, 'GET', '/status');
    assert.deepEqual(status.body, { connected: true, model: 'test-model', error: null });
    const res = await call(handler, 'POST', '/translate', { text: 'I made a website', category: 'school' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.bullets, ['Developed a website.']);
    assert.equal(sentHeaders['x-api-key'], 'sk-test');
    assert.ok(!JSON.stringify(res.body).includes('sk-test'));
  } finally {
    globalThis.fetch = original;
  }
});

test('extractJson tolerates code fences and extra text', () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('no json here'));
});
