// Lays out a cover letter on a US Letter page using the PDF writer.
import { PdfDocument, wrapText } from './pdf.js';

const PAGE = { width: 612, height: 792, margin: 72 };

export function buildLetterPdf({ letter, contact = {} }) {
  const doc = new PdfDocument({ title: `${contact.fullName || 'Cover letter'} – Cover letter`, author: contact.fullName || '' });
  const left = PAGE.margin;
  const width = PAGE.width - PAGE.margin * 2;
  let y = PAGE.margin;

  const line = (text, { font = 'regular', size = 11, color = '#1a1d24', height = 15.5 } = {}) => {
    if (y + height > PAGE.height - PAGE.margin) {
      doc.addPage();
      y = PAGE.margin;
    }
    doc.text(text, left, y + size, { font, size, color });
    y += height;
  };

  if (contact.fullName) line(contact.fullName, { font: 'bold', size: 13, height: 18 });
  const details = [contact.email, contact.phone, contact.location].filter(Boolean).join('  |  ');
  if (details) line(details, { size: 9.5, color: '#555b66' });
  if (contact.fullName || details) y += 14;
  line(new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }));
  y += 10;

  for (const para of String(letter || '').split(/\n/)) {
    if (!para.trim()) {
      y += 8;
      continue;
    }
    for (const l of wrapText(para.trim(), width, 'regular', 11)) line(l);
  }
  return doc.output();
}

export function downloadBytes(bytes, filename, type = 'application/pdf') {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function letterFileName(contact, company) {
  const part = (s) => String(s || '').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  return `${[part(contact?.fullName), 'Cover_Letter', part(company)].filter(Boolean).join('_')}.pdf`;
}
