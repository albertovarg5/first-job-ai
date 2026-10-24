// Lays out a resume on US Letter pages using the PDF writer.
import { PdfDocument, wrapText, textWidth } from './pdf.js';
import { dateRange } from './resume.js';
import { linesOf } from './utils.js';

const PAGE = { width: 612, height: 792, margin: 54 };
const INK = '#1a1d24';
const MUTED = '#555b66';
const RULE = '#b9bec7';

export function buildResumePdf(resume) {
  const c = resume.contact || {};
  const doc = new PdfDocument({ title: `${c.fullName || 'Resume'} – Resume`, author: c.fullName || '' });
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const contentWidth = right - left;
  let y = PAGE.margin;

  const ensure = (space) => {
    if (y + space > PAGE.height - PAGE.margin) {
      doc.addPage();
      y = PAGE.margin;
    }
  };

  const paragraph = (text, { font = 'regular', size = 10, color = INK, indent = 0, lineHeight = 13.5 } = {}) => {
    for (const line of wrapText(text, contentWidth - indent, font, size)) {
      ensure(lineHeight);
      doc.text(line, left + indent, y + size, { font, size, color });
      y += lineHeight;
    }
  };

  const bullets = (text) => {
    for (const item of linesOf(text)) {
      const lines = wrapText(item, contentWidth - 14, 'regular', 10);
      lines.forEach((line, i) => {
        ensure(13.5);
        if (i === 0) doc.text('•', left + 3, y + 10, { size: 10, color: INK });
        doc.text(line, left + 14, y + 10, { size: 10, color: INK });
        y += 13.5;
      });
    }
  };

  const sectionTitle = (title) => {
    ensure(40);
    y += 10;
    doc.text(title.toUpperCase(), left, y + 10.5, { font: 'bold', size: 10.5, color: INK });
    y += 15;
    doc.line(left, y, right, y, { width: 0.6, color: RULE });
    y += 7;
  };

  // Entry heading: bold title on the left, dates on the right.
  const entryHeader = (title, dates, subtitle) => {
    ensure(subtitle ? 30 : 16);
    const dateW = dates ? textWidth(dates, 'regular', 9.5) : 0;
    const titleLines = wrapText(title || '', contentWidth - dateW - 12, 'bold', 10.5);
    titleLines.forEach((line, i) => {
      doc.text(line, left, y + 10.5, { font: 'bold', size: 10.5, color: INK });
      if (i === 0 && dates) doc.text(dates, right - dateW, y + 10.5, { size: 9.5, color: MUTED });
      y += 14;
    });
    if (subtitle) paragraph(subtitle, { font: 'italic', size: 10, color: MUTED, lineHeight: 13.5 });
    y += 1;
  };

  // Header
  doc.text(c.fullName || 'Your Name', left, y + 22, { font: 'bold', size: 22, color: INK });
  y += 32;
  const contactLine = [c.email, c.phone, c.location, c.linkedin, c.website].filter(Boolean).join('   |   ');
  if (contactLine) paragraph(contactLine, { size: 9.5, color: MUTED, lineHeight: 12.5 });

  if (resume.summary?.trim()) {
    sectionTitle('Summary');
    paragraph(resume.summary.trim());
  }

  const education = (resume.education || []).filter((e) => e.school || e.degree);
  if (education.length) {
    sectionTitle('Education');
    education.forEach((e, i) => {
      const degree = [e.degree, e.field].filter(Boolean).join(', ');
      entryHeader(e.school, dateRange(e.start, e.end), degree);
      if (e.details?.trim()) bullets(e.details);
      if (i < education.length - 1) y += 5;
    });
  }

  const roleSection = (title, items) => {
    const list = items.filter((e) => e.role || e.org);
    if (!list.length) return;
    sectionTitle(title);
    list.forEach((e, i) => {
      const heading = [e.role, e.org].filter(Boolean).join(' – ');
      entryHeader(heading, dateRange(e.start, e.end), e.location);
      bullets(e.bullets);
      if (i < list.length - 1) y += 5;
    });
  };

  roleSection('Experience', resume.experience || []);

  const projects = (resume.projects || []).filter((p) => p.name);
  if (projects.length) {
    sectionTitle('Projects');
    projects.forEach((p, i) => {
      const sub = [p.role, p.link].filter(Boolean).join('   |   ');
      entryHeader(p.name, dateRange(p.start, p.end), sub);
      bullets(p.bullets);
      if (i < projects.length - 1) y += 5;
    });
  }

  roleSection('Volunteering', resume.volunteering || []);

  if ((resume.skills || []).length) {
    sectionTitle('Skills');
    paragraph(resume.skills.join(', '));
  }

  const achievements = (resume.achievements || []).filter((a) => a.title);
  if (achievements.length) {
    sectionTitle('Achievements');
    achievements.forEach((a) => {
      entryHeader(a.title, a.date, '');
      if (a.description?.trim()) paragraph(a.description.trim());
      y += 3;
    });
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
