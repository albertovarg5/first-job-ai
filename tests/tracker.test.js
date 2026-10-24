import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateApplication, validateApplication, withStatusHistory } from '../src/lib/applications.js';
import { normalizeData } from '../src/lib/storage.js';

const existing = [{ id: 'a1', company: 'Nike', title: 'Marketing Intern', location: 'Portland, OR', status: 'applied' }];

test('manual applications cannot duplicate a tracked job', () => {
  const dup = { company: ' nike ', title: 'marketing intern', location: 'portland, or' };
  assert.equal(findDuplicateApplication(dup, existing).id, 'a1');
  assert.match(validateApplication(dup, existing).title, /already in your tracker/);
  // Editing the same record is not a duplicate; a different city is a different job.
  assert.deepEqual(validateApplication({ ...dup, id: 'a1' }, existing), {});
  assert.deepEqual(validateApplication({ ...dup, location: 'Remote' }, existing), {});
});

test('status history records each change once', () => {
  let app = { statusHistory: withStatusHistory({}, 'interested', '2026-10-01T00:00:00Z') };
  app.statusHistory = withStatusHistory(app, 'applied', '2026-10-02T00:00:00Z');
  app.statusHistory = withStatusHistory(app, 'applied', '2026-10-03T00:00:00Z');
  app.statusHistory = withStatusHistory(app, 'interview', '2026-10-04T00:00:00Z');
  assert.deepEqual(app.statusHistory.map((h) => h.status), ['interested', 'applied', 'interview']);
});

test('notes length is limited', () => {
  assert.ok(validateApplication({ company: 'A', title: 'B', notes: 'x'.repeat(5001) }).notes);
});

test('applications with statuses, dates and notes persist through save and reload', () => {
  const app = { id: 'a2', company: 'Acme', title: 'Analyst', status: 'interview', dateApplied: '2026-10-01', interviewDate: '2026-10-30T10:00', notes: 'Met Sam' };
  const reloaded = normalizeData(JSON.parse(JSON.stringify({ applications: [app] })));
  assert.deepEqual(reloaded.applications[0], app);
});
