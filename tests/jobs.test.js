import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJSearchUrl, createJobsHandler, normalizeJob, parseSearchParams } from '../server/jobsHandler.js';
import {
  addSavedJob,
  findApplicationForJob,
  formatSalary,
  jobToApplication,
  removeSavedJob,
  searchToParams,
  validateSearch,
} from '../src/lib/jobs.js';
import { normalizeData } from '../src/lib/storage.js';
import { call, jsonResponse, withFetch } from './helpers.js';

const RAW_JOB = {
  job_id: 'abc123',
  job_title: 'Marketing Intern',
  employer_name: 'Acme Co',
  job_publisher: 'LinkedIn',
  job_employment_type: 'INTERN',
  job_apply_link: 'https://example.com/apply',
  job_description: 'Help with social media and Excel reports.',
  job_is_remote: false,
  job_city: 'Austin',
  job_state: 'TX',
  job_country: 'US',
  job_posted_at_datetime_utc: '2026-10-20T12:00:00.000Z',
  job_min_salary: 18,
  job_max_salary: 22,
  job_salary_currency: 'USD',
  job_salary_period: 'HOUR',
  job_highlights: { Qualifications: ['Currently enrolled student'] },
  job_required_experience: { no_experience_required: true },
};

const ok = (data) => jsonResponse({ status: 'OK', request_id: 'r1', data });

test('search params: validation and normalization', () => {
  const p = parseSearchParams(new URLSearchParams('query=  marketing   intern &location=Austin&employmentTypes=intern,PARTTIME&remote=true'));
  assert.equal(p.query, 'marketing intern');
  assert.deepEqual(p.employmentTypes, ['INTERN', 'PARTTIME']);
  assert.equal(p.remote, true);
  assert.equal(p.country, 'us');
  assert.throws(() => parseSearchParams(new URLSearchParams('query=a')), /at least 2/);
  assert.throws(() => parseSearchParams(new URLSearchParams('query=dev&page=0')), /Page/);
  assert.throws(() => parseSearchParams(new URLSearchParams('query=dev&datePosted=yesterday')), /date posted/);
  assert.throws(() => parseSearchParams(new URLSearchParams('query=dev&employmentTypes=VOLUNTEER')), /employment type/);
  assert.throws(() => parseSearchParams(new URLSearchParams('query=dev&country=zz')), /country/);
});

test('JSearch URL includes location, filters and a single page', () => {
  const url = new URL(buildJSearchUrl(parseSearchParams({ query: 'analyst', location: 'Denver', remote: 'true', experience: 'no_experience', page: '2' })));
  assert.equal(url.searchParams.get('query'), 'analyst in Denver');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('num_pages'), '1');
  assert.equal(url.searchParams.get('work_from_home'), 'true');
  assert.equal(url.searchParams.get('job_requirements'), 'no_experience');
});

test('normalizeJob keeps real fields and leaves unknowns empty', () => {
  const job = normalizeJob(RAW_JOB);
  assert.equal(job.location, 'Austin, TX, US');
  assert.deepEqual(job.employmentTypes, ['INTERN']);
  assert.deepEqual(job.salary, { min: 18, max: 22, currency: 'USD', period: 'HOUR' });
  assert.equal(job.experience.noExperienceRequired, true);
  assert.equal(normalizeJob({ ...RAW_JOB, job_min_salary: null, job_max_salary: null }).salary, null);
  assert.equal(normalizeJob({ ...RAW_JOB, job_apply_link: 'javascript:alert(1)' }).applyLink, '');
  assert.equal(normalizeJob({ job_title: 'No id' }), null);
  assert.match(formatSalary(job.salary), /18.*22.*\/hour/);
  assert.equal(formatSalary(null), '');
});

test('jobs route explains setup when no key is configured', async () => {
  const handler = createJobsHandler({});
  const status = await call(handler, 'GET', '/status');
  assert.equal(status.body.configured, false);
  const res = await call(handler, 'GET', '/search?query=developer');
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'not_configured');
});

test('jobs route: successful search sends the key server-side and caches results', async () => {
  let calls = 0;
  let sentHeaders;
  await withFetch(
    async (url, opts) => {
      calls += 1;
      sentHeaders = opts.headers;
      return ok(Array.from({ length: 10 }, (_, i) => ({ ...RAW_JOB, job_id: `id${i}` })));
    },
    async () => {
      const handler = createJobsHandler({ JSEARCH_API_KEY: 'rapid-secret' });
      const res = await call(handler, 'GET', '/search?query=marketing');
      assert.equal(res.status, 200);
      assert.equal(res.body.jobs.length, 10);
      assert.equal(res.body.hasMore, true);
      assert.equal(res.body.cached, false);
      assert.equal(sentHeaders['X-RapidAPI-Key'], 'rapid-secret');
      assert.ok(!JSON.stringify(res.body).includes('rapid-secret'));
      const again = await call(handler, 'GET', '/search?query=marketing');
      assert.equal(again.body.cached, true);
      assert.equal(calls, 1, 'the repeated search should come from the cache');
    },
  );
});

test('jobs route: empty results and duplicate ids', async () => {
  await withFetch(
    async () => ok([RAW_JOB, RAW_JOB]),
    async () => {
      const res = await call(createJobsHandler({ JSEARCH_API_KEY: 'k' }), 'GET', '/search?query=marketing');
      assert.equal(res.body.jobs.length, 1);
      assert.equal(res.body.hasMore, false);
    },
  );
  await withFetch(
    async () => ok([]),
    async () => {
      const res = await call(createJobsHandler({ JSEARCH_API_KEY: 'k' }), 'GET', '/search?query=zzzz');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.jobs, []);
    },
  );
});

test('jobs route: invalid key, rate limit, upstream error, network failure and timeout', async () => {
  const cases = [
    [async () => jsonResponse({ message: 'Invalid API key' }, 403), 502, 'invalid_key'],
    [async () => jsonResponse({ message: 'You are not subscribed' }, 401), 502, 'invalid_key'],
    [async () => jsonResponse({ message: 'Too many requests' }, 429), 429, 'rate_limited'],
    [async () => jsonResponse({ message: 'boom' }, 500), 502, 'upstream'],
    [async () => jsonResponse({ status: 'ERROR', error: {} }), 502, 'upstream'],
    [async () => { throw new TypeError('fetch failed'); }, 502, 'network'],
    [async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }, 504, 'timeout'],
  ];
  for (const [fake, status, code] of cases) {
    await withFetch(fake, async () => {
      const res = await call(createJobsHandler({ JSEARCH_API_KEY: 'k' }), 'GET', '/search?query=developer');
      assert.equal(res.status, status, code);
      assert.equal(res.body.code, code);
      assert.ok(res.body.error.length > 10);
    });
  }
});

test('jobs route: invalid input is rejected before calling the API', async () => {
  let called = false;
  await withFetch(
    async () => {
      called = true;
      return ok([]);
    },
    async () => {
      const res = await call(createJobsHandler({ JSEARCH_API_KEY: 'k' }), 'GET', '/search?query=x');
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'invalid_input');
    },
  );
  assert.equal(called, false);
});

test('jobs route: optional monthly limit stops requests', async () => {
  await withFetch(
    async () => ok([RAW_JOB]),
    async () => {
      const handler = createJobsHandler({ JSEARCH_API_KEY: 'k', JSEARCH_MONTHLY_LIMIT: '1' });
      assert.equal((await call(handler, 'GET', '/search?query=one')).status, 200);
      const res = await call(handler, 'GET', '/search?query=two');
      assert.equal(res.status, 429);
      assert.equal(res.body.code, 'local_limit');
      assert.equal((await call(handler, 'GET', '/status')).body.usedThisMonth, 1);
    },
  );
});

test('client: search validation and query string', () => {
  assert.ok(validateSearch({ query: ' ' }).query);
  assert.deepEqual(validateSearch({ query: 'barista', location: 'Ohio' }), {});
  const p = searchToParams({ query: 'barista ', location: '', remote: true, employmentTypes: ['PARTTIME'], datePosted: 'week' }, 3);
  assert.equal(p.toString(), 'query=barista&remote=true&employmentTypes=PARTTIME&datePosted=week&page=3');
});

test('saved jobs never duplicate and survive a reload', () => {
  const job = normalizeJob(RAW_JOB);
  let saved = addSavedJob([], job, '2026-10-23T00:00:00Z');
  saved = addSavedJob(saved, job);
  assert.equal(saved.length, 1);
  const reloaded = normalizeData(JSON.parse(JSON.stringify({ savedJobs: [...saved, ...saved], applications: [] })));
  assert.equal(reloaded.savedJobs.length, 1);
  assert.equal(removeSavedJob(saved, job.id).length, 0);
});

test('tracking a job links it to the listing and detects duplicates', () => {
  const job = normalizeJob(RAW_JOB);
  const app = { ...jobToApplication(job), id: 'a1' };
  assert.equal(app.status, 'interested');
  assert.equal(app.company, 'Acme Co');
  assert.equal(app.sourceJobId, 'abc123');
  assert.equal(findApplicationForJob([app], job).id, 'a1');
  // Manually added entry with the same link and title also counts.
  assert.ok(findApplicationForJob([{ id: 'm', title: 'marketing intern', link: job.applyLink }], job));
  assert.equal(findApplicationForJob([], job), null);
});
