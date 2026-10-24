import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyResume, resumeCompleteness, resumeChecklist } from '../src/lib/resume.js';
import { analyzeJobMatch, findSkills } from '../src/lib/jobMatch.js';
import { buildResumePdf } from '../src/lib/resumePdf.js';
import { textWidth, wrapText } from '../src/lib/pdf.js';

function sampleResume() {
  const r = emptyResume();
  r.contact = { ...r.contact, fullName: 'María Pérez', email: 'maria@example.com', phone: '555-0100', location: 'Eugene, OR' };
  r.summary = 'Business student with retail experience seeking a marketing internship.';
  r.education = [{ id: 'e1', school: 'University of Oregon', degree: 'B.A.', field: 'Business', start: '2023', end: '2027', details: '' }];
  r.experience = [{ id: 'x1', role: 'Cashier', org: 'Market', location: '', start: '2024', end: 'Present', bullets: 'Assisted customers\nHandled the register' }];
  r.skills = ['Customer service', 'Excel', 'Social media', 'Writing', 'Teamwork'];
  return r;
}

test('empty resume is 0% and full resume is 100%', () => {
  assert.equal(resumeCompleteness(emptyResume()), 0);
  assert.equal(resumeCompleteness(sampleResume()), 100);
  assert.equal(resumeChecklist(emptyResume()).reduce((s, i) => s + i.weight, 0), 100);
});

test('finds skills with word boundaries', () => {
  assert.deepEqual(findSkills('Experience with Excel and SQL'), ['SQL', 'Excel']);
  // "react" inside another word should not count
  assert.ok(!findSkills('We reacted quickly').includes('React'));
});

test('job match separates matched and missing skills', () => {
  const jd = 'Marketing intern. Requirements: Excel, Canva, social media and attention to detail. Bachelor degree in progress.';
  const result = analyzeJobMatch(sampleResume(), jd);
  assert.ok(result.matched.includes('Excel'));
  assert.ok(result.matched.includes('Social media'));
  assert.ok(result.missing.includes('Canva'));
  assert.ok(result.qualifications.some((q) => q.type === 'degree'));
  assert.ok(result.score > 0 && result.score < 100);
});

test('PDF output is a valid PDF with selectable text', () => {
  const bytes = buildResumePdf(sampleResume());
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.ok(text.includes('(University of Oregon)'));
  assert.ok(text.includes('/BaseFont /Helvetica'));
  // xref offset must point at the xref table
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
});

test('long resumes break onto a second page', () => {
  const r = sampleResume();
  r.experience = Array.from({ length: 8 }, (_, i) => ({ ...r.experience[0], id: `x${i}`, bullets: 'Line one of a long bullet that keeps going\n'.repeat(6) }));
  const text = new TextDecoder('latin1').decode(buildResumePdf(r));
  assert.match(text, /\/Count 2/);
});

test('text wrapping respects the width', () => {
  const lines = wrapText('word '.repeat(60), 200, 'regular', 10);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(textWidth(l, 'regular', 10) <= 200);
});
