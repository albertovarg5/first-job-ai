// Lays out a resume on US Letter pages using the PDF writer. The design
// (template, density, section order) comes from resumeLayout(), the same
// settings the on-screen preview uses. Text stays real text, so it can be
// selected, copied and read by applicant tracking systems.
import { PdfDocument, wrapText, textWidth } from './pdf.js';
import { dateRange, resumeLayout } from './resume.js';
import { linesOf } from './utils.js';

const PAGE = { width: 612, height: 792 };
const INK = '#1a1d24';
const MUTED = '#555b66';
const RULE = '#b9bec7';
const NAVY = '#1f3a5f';
const SCALE = { compact: 0.92, standard: 1, spacious: 1.08 };
const MARGIN = { compact: 46, standard: 54, spacious: 58 };

export function buildResumePdf(resume) {
  const c = resume.contact || {};
  const { template, density, order } = resumeLayout(resume);
  const k = SCALE[density];
  const margin = MARGIN[density];
  const accent = template === 'modern' ? NAVY : INK;
  const sz = { name: 22 * k, body: 10 * k, small: 9.5 * k, heading: 10.5 * k, line: 13.5 * k };
  const doc = new PdfDocument({ title: `${c.fullName || 'Resume'} – Resume`, author: c.fullName || '' });
  const left = margin;
  const right = PAGE.width - margin;
  const contentWidth = right - left;
  const bottom = PAGE.height - margin;
  let y = margin;

  const ensure = (space) => {
    if (y + space > bottom) {
      doc.addPage();
      y = margin;
    }
  };

  const centeredX = (str, font, size) => left + Math.max(0, (contentWidth - textWidth(str, font, size)) / 2);

  const paragraph = (text, { font = 'regular', size = sz.body, color = INK, indent = 0, lineHeight = sz.line, center = false } = {}) => {
    for (const line of wrapText(text, contentWidth - indent, font, size)) {
      ensure(lineHeight);
      doc.text(line, center ? centeredX(line, font, size) : left + indent, y + size, { font, size, color });
      y += lineHeight;
    }
  };

  const bullets = (text) => {
    for (const item of linesOf(text)) {
      const lines = wrapText(item, contentWidth - 14 * k, 'regular', sz.body);
      // A short bullet (up to 2 lines) never splits across pages.
      ensure(Math.min(lines.length, 2) * sz.line);
      lines.forEach((line, i) => {
        ensure(sz.line);
        if (i === 0) doc.text('•', left + 3 * k, y + sz.body, { size: sz.body, color: INK });
        doc.text(line, left + 14 * k, y + sz.body, { size: sz.body, color: INK });
        y += sz.line;
      });
    }
  };

  const sectionTitle = (title) => {
    // Keep a heading with at least the first entry line under it.
    ensure(10 * k + 22 * k + 2 * sz.line);
    y += 10 * k;
    doc.text(title.toUpperCase(), left, y + sz.heading, { font: 'bold', size: sz.heading, color: accent });
    y += 15 * k;
    doc.line(left, y, right, y, { width: 0.6, color: template === 'modern' ? NAVY : RULE });
    y += 7 * k;
  };

  // Entry heading: bold title on the left, dates on the right, kept with its first line of content.
  const entryHeader = (title, dates, subtitle, hasBody) => {
    const dateW = dates ? textWidth(dates, 'regular', sz.small) : 0;
    const titleLines = wrapText(title || '', contentWidth - dateW - 12, 'bold', sz.heading);
    const subLines = subtitle ? wrapText(subtitle, contentWidth, 'italic', sz.body).length : 0;
    ensure(titleLines.length * 14 * k + subLines * sz.line + (hasBody ? sz.line : 0));
    titleLines.forEach((line, i) => {
      doc.text(line, left, y + sz.heading, { font: 'bold', size: sz.heading, color: INK });
      if (i === 0 && dates) doc.text(dates, right - dateW, y + sz.heading, { size: sz.small, color: MUTED });
      y += 14 * k;
    });
    if (subtitle) paragraph(subtitle, { font: 'italic', size: sz.body, color: MUTED });
    y += 1;
  };

  const entries = (list, render) =>
    list.forEach((e, i) => {
      render(e);
      if (i < list.length - 1) y += 5 * k;
    });

  // Header
  const name = c.fullName || 'Your Name';
  const center = template === 'modern';
  doc.text(name, center ? centeredX(name, 'bold', sz.name) : left, y + sz.name, { font: 'bold', size: sz.name, color: accent });
  y += sz.name + 10 * k;
  const contactLine = [c.email, c.phone, c.location, c.linkedin, c.website].filter(Boolean).join('   |   ');
  if (contactLine) paragraph(contactLine, { size: sz.small, color: MUTED, lineHeight: 12.5 * k, center });

  const roles = (title, items) => {
    const list = (items || []).filter((e) => e.role || e.org);
    if (!list.length) return;
    sectionTitle(title);
    entries(list, (e) => {
      entryHeader([e.role, e.org].filter(Boolean).join(' – '), dateRange(e.start, e.end), e.location, linesOf(e.bullets).length > 0);
      bullets(e.bullets);
    });
  };

  const SECTIONS = {
    summary: () => {
      if (!resume.summary?.trim()) return;
      sectionTitle('Summary');
      paragraph(resume.summary.trim());
    },
    education: () => {
      const list = (resume.education || []).filter((e) => e.school || e.degree);
      if (!list.length) return;
      sectionTitle('Education');
      entries(list, (e) => {
        entryHeader(e.school, dateRange(e.start, e.end), [e.degree, e.field].filter(Boolean).join(', '), linesOf(e.details).length > 0);
        if (e.details?.trim()) bullets(e.details);
      });
    },
    experience: () => roles('Experience', resume.experience),
    projects: () => {
      const list = (resume.projects || []).filter((p) => p.name);
      if (!list.length) return;
      sectionTitle('Projects');
      entries(list, (p) => {
        entryHeader(p.name, dateRange(p.start, p.end), [p.role, p.link].filter(Boolean).join('   |   '), linesOf(p.bullets).length > 0);
        bullets(p.bullets);
      });
    },
    volunteering: () => roles('Volunteering', resume.volunteering),
    skills: () => {
      if (!(resume.skills || []).length) return;
      sectionTitle('Skills');
      paragraph(resume.skills.join(', '));
    },
    achievements: () => {
      const list = (resume.achievements || []).filter((a) => a.title);
      if (!list.length) return;
      sectionTitle('Achievements');
      list.forEach((a) => {
        entryHeader(a.title, a.date, '', Boolean(a.description?.trim()));
        if (a.description?.trim()) paragraph(a.description.trim());
        y += 3 * k;
      });
    },
  };
  for (const id of order) SECTIONS[id]();

  // Page numbers once the total is known, only when there is more than one page.
  const total = doc.pages.length;
  if (total > 1) {
    for (let i = 0; i < total; i += 1) {
      const label = `${c.fullName ? `${c.fullName} – ` : ''}Page ${i + 1} of ${total}`;
      doc.text(label, centeredX(label, 'regular', 8.5), PAGE.height - margin / 2, { size: 8.5, color: MUTED, page: i });
    }
  }

  return doc.output();
}

export function resumeFileName(resume) {
  const name = (resume.contact?.fullName || 'resume').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  return `${name || 'resume'}_Resume.pdf`;
}

// Browser-only: triggers a file download.
export function downloadResumePdf(resume) {
  const bytes = buildResumePdf(resume);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = resumeFileName(resume);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
