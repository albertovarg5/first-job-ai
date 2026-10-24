import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicCoverLetter, basicSummary, fillName, placeholderCount } from '../src/lib/careerText.js';
import { findTransferableSkills, improvementSuggestions, verifyAiSkills } from '../src/lib/transferable.js';
import { buildQuestionSet, questionsFromJob } from '../src/lib/questionBank.js';
import { rankJobs, scoreJob } from '../src/lib/recommend.js';
import { emptyResume, resumeToText } from '../src/lib/resume.js';
import { createAiHandler } from '../server/aiHandler.js';
import { call, withFetch } from './helpers.js';

const resume = {
  ...emptyResume(),
  contact: { ...emptyResume().contact, fullName: 'Jordan Lee', email: 'jordan@example.com', phone: '555-0100' },
  education: [{ school: 'State University', degree: 'B.A.', field: 'Communications', end: 'Expected May 2027', details: '' }],
  experience: [{ role: 'Cashier', org: 'Corner Market', bullets: 'Helped customers find products and answered questions\nCounted the cash register at closing' }],
  projects: [{ name: 'Club website', bullets: 'Built a website for the robotics club with two classmates' }],
  skills: ['Customer service', 'Excel', 'Social media'],
};

const JOB = `Marketing Assistant. We need someone with social media experience, Excel and Salesforce.
You will help customers and write content. Bachelor's degree preferred. 2+ years of experience.`;

test('basic summary only uses the resume', () => {
  const s = basicSummary(resume, 'Marketing assistant');
  assert.match(s, /B\.A\. in Communications from State University \(Expected May 2027\)/);
  assert.match(s, /Cashier at Corner Market/);
  assert.match(s, /Seeking a Marketing assistant role/);
  assert.ok(!/\d+%|\bincreased\b/i.test(s));
  assert.equal(basicSummary(emptyResume(), ''), '');
});

test('basic cover letter never claims missing skills and marks gaps', () => {
  const { letter, gaps, matched } = basicCoverLetter({ resume, name: 'Jordan Lee', jobTitle: 'Marketing Assistant', company: 'Acme', jobDescription: JOB });
  assert.ok(gaps.includes('Salesforce'));
  assert.ok(!letter.includes('Salesforce'), 'a skill the resume lacks must not appear in the letter');
  assert.ok(matched.includes('Excel'));
  assert.match(letter, /^Dear Hiring Manager,/);
  assert.match(letter, /Sincerely,\nJordan Lee$/);
  assert.match(letter, /helped customers find products/);
  // No "why this company" notes → a placeholder instead of invented enthusiasm.
  assert.ok(placeholderCount(letter) >= 1);
  const withNotes = basicCoverLetter({ resume, jobTitle: 'X', company: 'Acme', jobDescription: JOB, notes: 'I use Acme products every day.' });
  assert.match(withNotes.letter, /I use Acme products every day\./);
  assert.match(withNotes.letter, /\[Your name\]$/);
});

test('fillName replaces the AI placeholder locally', () => {
  assert.equal(fillName('Sincerely,\n[Your name]', 'Sam Diaz'), 'Sincerely,\nSam Diaz');
  assert.equal(fillName('Sincerely,\n[Your name]', ''), 'Sincerely,\n[Your name]');
});

test('AI prompts can leave out contact details', () => {
  const text = resumeToText(resume, { includeContact: false });
  assert.ok(!text.includes('Jordan Lee'));
  assert.ok(!text.includes('jordan@example.com'));
  assert.ok(text.includes('Cashier'));
});

test('transferable skills cite the exact resume line', () => {
  const skills = findTransferableSkills(resume);
  const service = skills.find((s) => s.name === 'Customer service');
  assert.ok(service);
  assert.equal(service.evidence[0].source, 'Cashier, Corner Market');
  assert.equal(service.evidence[0].text, 'Helped customers find products and answered questions');
  assert.ok(skills.find((s) => s.name === 'Teamwork')?.evidence[0].text.includes('two classmates'));
  assert.deepEqual(findTransferableSkills(emptyResume()), []);
});

test('improvement suggestions skip skills already listed', () => {
  const { field, suggestions } = improvementSuggestions(resume, 'Marketing assistant');
  assert.equal(field, 'marketing');
  assert.ok(!suggestions.some((s) => s.skill === 'Social media'));
  assert.ok(suggestions.length > 0);
});

test('AI skills without real evidence are dropped', () => {
  const text = resumeToText(resume, { includeContact: false });
  const { verified, dropped } = verifyAiSkills(
    [
      { name: 'Customer service', evidence: 'Helped customers find products' },
      { name: 'Leadership', evidence: 'Managed a team of 10 people' },
      { name: 'Vague', evidence: '' },
    ],
    text,
  );
  assert.deepEqual(verified.map((v) => v.name), ['Customer service']);
  assert.equal(dropped, 2);
});

test('interview questions can be based on the job description', () => {
  const qs = questionsFromJob(JOB, 3);
  assert.equal(qs.length, 3);
  assert.ok(qs.every((q) => q.source === 'job' && q.category === 'technical'));
  assert.ok(qs.some((q) => q.question.includes('Excel')));
  const set = buildQuestionSet({ jobTitle: 'Marketing assistant', type: 'mixed', count: 6, seed: 1, jobDescription: JOB });
  assert.equal(set.questions.length, 6);
  assert.equal(set.questions[0].question, 'Tell me about yourself.');
  assert.equal(set.questions.filter((q) => q.source === 'job').length, 2);
  // Without a description, behaviour is unchanged.
  assert.ok(!buildQuestionSet({ jobTitle: 'x', type: 'mixed', count: 5, seed: 1 }).questions.some((q) => q.source === 'job'));
});

test('recommendations explain matches with facts and rank better fits first', () => {
  const good = { id: 'g', title: 'Marketing Assistant', description: JOB, employmentTypes: ['FULLTIME'], highlights: {}, experience: { noExperienceRequired: true } };
  const poor = { id: 'p', title: 'Senior Java Engineer', description: 'Java, AWS, Linux. 8+ years of experience.', employmentTypes: [], highlights: {}, experience: { months: 96 } };
  const profile = { targetRole: 'Marketing Assistant', goals: ['full-time'], interests: ['content'] };
  const r = scoreJob(good, { resume, profile });
  assert.ok(r.reasons.some((x) => x.includes('Excel')));
  assert.ok(r.reasons.some((x) => x.includes('no experience')));
  assert.ok(r.checks.some((x) => x.includes('Salesforce')));
  const ranked = rankJobs([poor, good], { resume, profile });
  assert.deepEqual(ranked.map((x) => x.job.id), ['g', 'p']);
  assert.ok(ranked[1].checks.some((x) => x.includes('8 years')));
});

test('AI route validates new task output', async () => {
  const handler = createAiHandler({ ANTHROPIC_API_KEY: 'k' });
  const reply = (obj) => async (url) =>
    String(url).includes('/v1/models') ? new Response('{}') : new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }));
  await withFetch(reply({ questions: [{ question: 'Why us?', category: 'general' }] }), async () => {
    const res = await call(handler, 'POST', '/questions', { jobTitle: 'Analyst', count: '1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.questions[0].question, 'Why us?');
  });
  await withFetch(reply({ questions: [{ question: 'Why us?', category: 'trick' }] }), async () => {
    const res = await call(handler, 'POST', '/questions', { jobTitle: 'Analyst', count: '1' });
    assert.equal(res.status, 502);
  });
  await withFetch(reply({ letter: 'Dear Hiring Manager,\n\nI am applying for the role at Acme because ...\n\nSincerely,\n[Your name]', gaps: ['SQL'] }), async () => {
    const res = await call(handler, 'POST', '/coverLetter', { resumeText: 'x', jobTitle: 'A', company: 'B', jobDescription: 'C' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.gaps, ['SQL']);
  });
});
