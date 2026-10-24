// A tiny, dependency-free PDF writer for text documents.
// Uses the PDF standard fonts (Helvetica family), so files are small, the text
// is selectable, and applicant tracking systems can read it.

const HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVETICA_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

// Unicode characters that exist in WinAnsi (cp1252) outside Latin-1.
const WIN_ANSI_EXTRA = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, '‰': 0x89, '‹': 0x8b,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, '›': 0x9b,
};
const EXTRA_WIDTHS = { 0x95: 350, 0x96: 556, 0x97: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x85: 1000 };

const FONTS = {
  regular: { key: 'F1', base: 'Helvetica', widths: HELVETICA },
  bold: { key: 'F2', base: 'Helvetica-Bold', widths: HELVETICA_BOLD },
  italic: { key: 'F3', base: 'Helvetica-Oblique', widths: HELVETICA },
};

// Convert a JS string to WinAnsi byte codes; unsupported characters become "?".
export function toWinAnsiCodes(str) {
  const codes = [];
  for (const ch of String(str ?? '')) {
    const cp = ch.codePointAt(0);
    if (WIN_ANSI_EXTRA[ch]) codes.push(WIN_ANSI_EXTRA[ch]);
    else if (cp === 9) codes.push(32);
    else if ((cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255)) codes.push(cp);
    else codes.push(63);
  }
  return codes;
}

export function textWidth(str, font = 'regular', size = 10) {
  const widths = FONTS[font].widths;
  let total = 0;
  for (const c of toWinAnsiCodes(str)) {
    if (c >= 32 && c <= 126) total += widths[c - 32];
    else total += EXTRA_WIDTHS[c] ?? 556;
  }
  return (total * size) / 1000;
}

export function wrapText(str, maxWidth, font = 'regular', size = 10) {
  const lines = [];
  for (const paragraph of String(str ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function escapePdfString(codes) {
  let out = '';
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += `\\${String.fromCharCode(c)}`;
    else if (c > 126) out += `\\${c.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(c);
  }
  return out;
}

const n = (v) => (Math.round(v * 100) / 100).toString();

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => n(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');
}

export class PdfDocument {
  constructor({ width = 612, height = 792, title = 'Document', author = '' } = {}) {
    this.width = width;
    this.height = height;
    this.title = title;
    this.author = author;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.pages.push([]);
  }

  get ops() {
    return this.pages[this.pages.length - 1];
  }

  // y is measured from the top of the page (easier for layout code).
  text(str, x, y, { font = 'regular', size = 10, color = '#000000' } = {}) {
    const f = FONTS[font];
    const py = this.height - y;
    this.ops.push(`BT /${f.key} ${n(size)} Tf ${rgb(color)} rg ${n(x)} ${n(py)} Td (${escapePdfString(toWinAnsiCodes(str))}) Tj ET`);
  }

  line(x1, y1, x2, y2, { width = 0.5, color = '#000000' } = {}) {
    this.ops.push(`${n(width)} w ${rgb(color)} RG ${n(x1)} ${n(this.height - y1)} m ${n(x2)} ${n(this.height - y2)} l S`);
  }

  // Returns the finished PDF as bytes.
  output() {
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };
    const catalogId = add(null);
    const pagesId = add(null);
    const fontIds = {};
    for (const f of Object.values(FONTS)) {
      fontIds[f.key] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`);
    }
    const fontRes = Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
    const pageIds = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << ${fontRes} >> >> /Contents ${contentId} 0 R >>`,
        ),
      );
    }
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const infoId = add(
      `<< /Title (${escapePdfString(toWinAnsiCodes(this.title))}) /Author (${escapePdfString(toWinAnsiCodes(this.author))}) /Producer (First Job AI) >>`,
    );

    // All content is ASCII at this point (non-ASCII is octal-escaped),
    // so string length equals byte length for the xref offsets.
    let out = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out);
  }
}
