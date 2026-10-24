// Basic-mode (no AI) drafts for the resume summary and cover letters.
// Every sentence is built from what the user entered. Anything we don't know
// becomes a [bracketed prompt] for the user to fill in — never a guess.
import { analyzeJobMatch } from './jobMatch.js';
import { linesOf } from './utils.js';

const listText = (items) => {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

const stripEnd = (s) => String(s || '').trim().replace(/[.;,\s]+$/, '');

function educationPhrase(edu) {
  if (!edu?.school?.trim()) return '';
  const degree = edu.degree?.trim();
  const field = edu.field?.trim();
  let what;
  if (degree && field) what = `${article(degree)} ${degree} in ${field}`;
  else if (degree) what = `${article(degree)} ${degree}`;
  else if (field) what = `studies in ${field}`;
  else what = 'studies';
  return `${what} from ${edu.school.trim()}${edu.end?.trim() ? ` (${edu.end.trim()})` : ''}`;
}

function roles(resume) {
  const out = [];
  for (const key of ['experience', 'volunteering']) {
    for (const e of resume[key] || []) if (e.role?.trim()) out.push({ ...e, kind: key, label: e.org?.trim() ? `${e.role.trim()} at ${e.org.trim()}` : e.role.trim() });
  }
  for (const p of resume.projects || []) if (p.name?.trim()) out.push({ ...p, kind: 'project', label: p.name.trim() });
  return out;
}

export function basicSummary(resume, targetRole = '') {
  const sentences = [];
  const edu = educationPhrase((resume.education || [])[0]);
  if (edu) sentences.push(`Candidate with ${edu}.`);
  const exp = roles(resume).filter((r) => r.kind !== 'project').slice(0, 2);
  if (exp.length) sentences.push(`Experience as ${listText(exp.map((r) => r.label))}.`);
  const skills = (resume.skills || []).slice(0, 4);
  if (skills.length) sentences.push(`Skills include ${listText(skills)}.`);
  if (targetRole.trim()) sentences.push(`Seeking ${article(targetRole.trim())} ${targetRole.trim()} role.`);
  return sentences.join(' ');
}

// Returns { letter, gaps, matched } — gaps are skills the posting mentions
// that the resume doesn't show (so the letter does not claim them).
export function basicCoverLetter({ resume, name = '', jobTitle, company, jobDescription = '', notes = '' }) {
  const match = analyzeJobMatch(resume, jobDescription);
  const role = jobTitle?.trim() || '[job title]';
  const org = company?.trim() || '[company]';
  const paragraphs = [];

  const edu = educationPhrase((resume.education || [])[0]);
  paragraphs.push(`I am writing to apply for the ${role} position at ${org}.${edu ? ` I have ${edu}.` : ''}`);

  const relevant = roles(resume).slice(0, 2);
  if (relevant.length) {
    const lines = relevant.map((r) => {
      const first = linesOf(r.bullets)[0];
      const where = r.kind === 'project' ? `On my project ${r.label}` : `As ${r.label}`;
      return first ? `${where}, my work included: ${stripEnd(first).replace(/^./, (c) => c.toLowerCase())}.` : `${where}, [describe one thing you did there that relates to this job].`;
    });
    paragraphs.push(lines.join(' '));
  } else {
    paragraphs.push('[Describe one class project, job, volunteer role or activity that relates to this position. Add it to your resume to have it included here.]');
  }

  if (match.matched.length) {
    paragraphs.push(
      `Your posting mentions ${listText(match.matched.slice(0, 4))}. These are skills listed on my resume, and I would be glad to talk about where I have used them.`,
    );
  }

  paragraphs.push(notes.trim() || `[Add one or two sentences about why you want to work at ${org} — something specific you know or like about them.]`);
  paragraphs.push(`Thank you for considering my application. I would welcome the chance to discuss how I can contribute to ${org}.`);

  const letter = ['Dear Hiring Manager,', ...paragraphs, `Sincerely,\n${name.trim() || '[Your name]'}`].join('\n\n');
  return { letter, gaps: match.missing, matched: match.matched };
}

export const placeholderCount = (text) => (String(text).match(/\[[^\]]+\]/g) || []).length;

// AI letters end with "[Your name]"; fill it in on this device so the name
// never has to be sent to the AI provider.
export function fillName(letter, name) {
  return name?.trim() ? String(letter).replace(/\[Your name\]/gi, name.trim()) : letter;
}
