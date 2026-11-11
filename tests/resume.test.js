import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyResume, resumeCompleteness, resumeChecklist, resumeLayout } from '../src/lib/resume.js';
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

// ---------- Resume designs and PDF layout ----------

// Each page's text in drawing order: [{ font, size, text, y }].
function pdfPages(bytes) {
  const raw = new TextDecoder('latin1').decode(bytes);
  return [...raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(([, s]) =>
    [...s.matchAll(/\/(F\d) ([\d.]+) Tf .*? Td \(((?:\.|[^)])*)\) Tj/g)].map(([, font, size, text]) => ({ font, size: Number(size), text })),
  );
}
const allText = (bytes) => pdfPages(bytes).flat().map((t) => t.text).join('\n');

function longResume(layout) {
  const r = sampleResume();
  r.layout = layout;
  r.experience = Array.from({ length: 9 }, (_, i) => ({
    id: `x${i}`, role: `Role ${i + 1}`, org: `Company ${i + 1}`, location: 'Remote', start: '2020', end: '2021',
    bullets: Array.from({ length: 4 }, (_, j) => `Bullet ${j + 1} for role ${i + 1}, long enough to wrap onto a second line of text in the PDF layout`).join('\n'),
  }));
  return r;
}

test('designs: Experienced puts experience before education; switching designs keeps every word', () => {
  const r = sampleResume();
  const order = (layout) => {
    const text = allText(buildResumePdf({ ...r, layout }));
    return [text.indexOf('EDUCATION'), text.indexOf('EXPERIENCE')];
  };
  const [eduC, expC] = order(undefined);
  assert.ok(eduC < expC, 'Classic (default): education first');
  const [eduX, expX] = order({ template: 'experienced' });
  assert.ok(expX < eduX, 'Experienced: experience first');
  const words = (layout) => allText(buildResumePdf({ ...r, layout })).split('\n').sort();
  assert.deepEqual(words({ template: 'modern' }), words({ template: 'classic' }), 'same content in every design');
  assert.deepEqual(resumeLayout({ layout: { template: 'fancy', density: 'huge' } }), resumeLayout({}), 'unknown values fall back to the defaults');
});

test('designs: Modern colours headings navy; density changes text size', () => {
  const raw = (layout) => new TextDecoder('latin1').decode(buildResumePdf({ ...sampleResume(), layout }));
  assert.match(raw({ template: 'modern' }), /0\.12 0\.23 0\.37 rg [\d.]+ [\d.]+ Td \(EDUCATION\)/);
  const bodySize = (density) => pdfPages(buildResumePdf({ ...sampleResume(), layout: { density } }))[0].find((t) => t.text === 'Assisted customers').size;
  assert.ok(bodySize('compact') < bodySize('standard') && bodySize('standard') < bodySize('spacious'));
});

test('multi-page PDF: page numbers on every page, no heading left alone at the bottom of a page', () => {
  for (const density of ['compact', 'standard', 'spacious']) {
    for (const template of ['classic', 'modern', 'experienced']) {
      const pages = pdfPages(buildResumePdf(longResume({ template, density })));
      assert.ok(pages.length >= 2, `${template}/${density} needs more than one page`);
      pages.forEach((page, i) => {
        assert.ok(page.some((t) => t.text.endsWith(`Page ${i + 1} of ${pages.length}`)), 'page number');
        const body = page.filter((t) => !t.text.includes(' of '));
        assert.notEqual(body.at(-1).font, 'F2', `${template}/${density}: page ${i + 1} must not end on a bold heading`);
      });
      const text = pages.flat().map((t) => t.text).join('\n');
      for (let i = 1; i <= 9; i += 1) assert.ok(text.includes(`Role ${i} ${String.fromCharCode(92)}226 Company ${i}`), 'nothing is cut off'); // – is stored as 
    }
  }
  assert.ok(!allText(buildResumePdf(sampleResume())).includes('Page 1 of'), 'a one-page resume has no page number');
});

test('PDF handles empty fields, missing optional sections and special characters', () => {
  const empty = allText(buildResumePdf(emptyResume()));
  assert.ok(empty.includes('Your Name'));
  assert.ok(!/SUMMARY|EDUCATION|EXPERIENCE|PROJECTS|SKILLS/.test(empty), 'empty sections are left out');
  const r = sampleResume();
  const BS = String.fromCharCode(92);
  r.summary = `Café “quotes” – em—dash, 100% (parentheses) ${BS} backslash & ümlaut`;
  r.experience[0].bullets = '\n\n  \nReal bullet\n\n';
  const raw = new TextDecoder('latin1').decode(buildResumePdf(r));
  assert.ok(raw.includes(`${BS}(parentheses${BS})`) && raw.includes(`${BS}${BS} backslash`), 'PDF special characters are escaped');
  assert.ok(raw.includes('(Real bullet)'));
  const bulletMarks = pdfPages(buildResumePdf(r)).flat().filter((t) => t.text === `${BS}225`).length; // • is stored as 
  assert.equal(bulletMarks, 1, 'blank lines make no empty bullets');
});
