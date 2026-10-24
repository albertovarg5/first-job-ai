// Finds transferable skills in the user's own resume entries and shows the
// exact line that supports each one. No AI; nothing is added that the user
// did not write.
import { fieldForTitle } from './questionBank.js';
import { findSkills } from './jobMatch.js';
import { resumeToText } from './resume.js';
import { linesOf } from './utils.js';

const SKILLS = [
  ['Customer service', 'Employers in almost every field value people who can help customers calmly.', ['customers?', 'clients?', 'guests?', 'patrons?', 'shoppers?']],
  ['Communication', 'Explaining things clearly is one of the most requested skills in entry-level postings.', ['communicat\\w*', 'explain\\w*', 'answer\\w* questions', 'emails?', 'phone calls?', 'talked']],
  ['Teamwork', 'Most jobs involve working with others toward a shared goal.', ['team', 'teams', 'teammates?', 'collaborat\\w*', 'group project', 'with (?:two|three|four|five|\\d+) (?:other )?(?:people|students|classmates|volunteers)', 'worked with']],
  ['Leadership', 'Shows you can take responsibility and guide others.', ['led', 'lead', 'leading', 'in charge', 'president', 'captain', 'supervis\\w*', 'manag\\w* (?:a|the) team', 'organized a']],
  ['Teaching and mentoring', 'Training new coworkers and explaining tasks are common duties.', ['taught', 'teach\\w*', 'tutor\\w*', 'mentor\\w*', 'trained', 'training new', 'coached']],
  ['Organization and planning', 'Planning work and keeping things in order transfers to any role.', ['organiz\\w*', 'planned', 'planning', 'scheduled', 'scheduling', 'coordinat\\w*', 'arranged']],
  ['Time management', 'Balancing work, school and deadlines shows reliability.', ['deadlines?', 'on time', 'while (?:studying|attending|taking)', 'full-time student', 'shifts?', 'prioritiz\\w*']],
  ['Problem solving', 'Employers want people who can figure things out.', ['solv\\w*', 'resolv\\w*', 'fix\\w*', 'troubleshoot\\w*', 'debug\\w*', 'issues?', 'problems?', 'complaints?']],
  ['Attention to detail', 'Accuracy matters in data entry, finance, healthcare and more.', ['accura\\w*', 'counted', 'cash', 'register', 'inventory', 'checked', 'reconcil\\w*', 'records?', 'data entry']],
  ['Writing', 'Clear writing is needed for emails, reports and documentation.', ['wrote', 'writ\\w*', 'articles?', 'blog', 'reports?', 'newsletter', 'essays?', 'posts?']],
  ['Public speaking and presenting', 'Presenting ideas helps in meetings, sales and interviews.', ['present\\w*', 'speech', 'spoke', 'pitched', 'pitch']],
  ['Research and analysis', 'Gathering and making sense of information is useful in most office roles.', ['research\\w*', 'analy[sz]\\w*', 'surveys?', 'data', 'spreadsheets?', 'excel']],
  ['Technical skills', 'Building things with technology shows you can learn tools quickly.', ['built', 'developed', 'coded', 'programm\\w*', 'website', 'app', 'bot', 'python', 'javascript', 'software']],
  ['Sales and persuasion', 'Recommending products or ideas is valuable in sales, marketing and service.', ['sold', 'sales?', 'upsell\\w*', 'recommend\\w*', 'fundrais\\w*', 'raised', 'promot\\w*', 'recruit\\w*']],
  ['Adaptability', 'Handling change and busy periods is valued everywhere.', ['fast-paced', 'busy', 'rush', 'adapt\\w*', 'quickly learned', 'learned (?:how|to)', 'new (?:system|software|tool)']],
].map(([name, why, patterns]) => ({ name, why, re: new RegExp(`\\b(?:${patterns.join('|')})\\b`, 'i') }));

function entries(resume) {
  const out = [];
  const push = (source, text) => linesOf(text).forEach((line) => out.push({ source, text: line }));
  for (const e of resume.experience || []) push([e.role, e.org].filter(Boolean).join(', ') || 'Job', e.bullets);
  for (const e of resume.volunteering || []) push([e.role, e.org].filter(Boolean).join(', ') || 'Volunteering', e.bullets);
  for (const p of resume.projects || []) push(p.name || 'Project', p.bullets);
  for (const e of resume.education || []) push(e.school || 'Education', e.details);
  for (const a of resume.achievements || []) push(a.title || 'Achievement', a.description);
  return out;
}

// Returns [{ name, why, evidence: [{ source, text }] }] sorted by evidence count.
export function findTransferableSkills(resume) {
  const lines = entries(resume || {});
  return SKILLS.map((s) => ({ name: s.name, why: s.why, evidence: lines.filter((l) => s.re.test(l.text)).slice(0, 3) }))
    .filter((s) => s.evidence.length)
    .sort((a, b) => b.evidence.length - a.evidence.length);
}

const FIELD_SKILLS = {
  software: [['Git', 'Put a small project on GitHub and commit to it regularly.'], ['JavaScript', 'Build one small web app (a to-do list or budget tracker) and link it on your resume.'], ['SQL', 'Free interactive SQL courses take a weekend; add a project that queries real data.'], ['Testing', 'Add a few unit tests to a project you already built.']],
  data: [['Excel', 'Practice pivot tables and lookups on a public dataset.'], ['SQL', 'Complete a free SQL course and save your queries in a portfolio project.'], ['Data visualization', 'Build one dashboard (Tableau Public or Power BI) from a public dataset.'], ['Python', 'Analyze a dataset you care about with Python and write up what you found.']],
  design: [['Figma', 'Redesign one screen of an app you use and explain your choices.'], ['UX research', 'Interview 3–5 people about a problem and summarize what you learned.'], ['Adobe Creative Suite', 'Make a small portfolio piece with Photoshop or Illustrator.']],
  marketing: [['Social media', 'Run a social account for a club, nonprofit or small business for a month.'], ['Content creation', 'Write three sample posts or a short blog series about a topic you know.'], ['Google Analytics', 'Google offers a free Analytics certification.'], ['SEO', 'Take a free SEO course and apply it to a personal or club website.']],
  finance: [['Excel', 'Build a personal budget model with formulas and charts.'], ['Accounting', 'An introductory accounting course (online or at school) covers the basics employers expect.'], ['QuickBooks', 'Intuit offers QuickBooks training and a certification.']],
  business: [['Microsoft Office', 'Practice Excel, Word and PowerPoint; free Microsoft Learn modules help.'], ['Project management', 'Volunteer to coordinate a club event and track tasks in a simple plan.'], ['CRM', 'Free Salesforce Trailhead modules teach CRM basics.']],
  healthcare: [['CPR / First aid', 'Get CPR / BLS certified through the Red Cross or American Heart Association.'], ['Patient care', 'Volunteer at a hospital, clinic or care home.'], ['Scheduling', 'Front-desk or reception work builds scheduling experience.']],
  education: [['Tutoring', 'Volunteer as a tutor at school, a library or online.'], ['Teaching', 'Help run a workshop or lesson for a club or community group.'], ['Public speaking', 'Present in class or at a club meeting and ask for feedback.']],
  service: [['Customer service', 'Any customer-facing job or volunteer role builds this quickly.'], ['Cash handling', 'Retail and food service jobs teach point-of-sale systems.'], ['Food safety', 'A food handler certificate is quick and inexpensive in most areas.']],
  general: [['Microsoft Office', 'Practice Excel, Word and PowerPoint; free Microsoft Learn modules help.'], ['Communication', 'Join a club role that involves emailing, presenting or organizing.'], ['Customer service', 'A part-time or volunteer role working with the public builds this fast.']],
};

// General suggestions for the target field, skipping skills the resume already shows.
export function improvementSuggestions(resume, targetRole) {
  const field = fieldForTitle(targetRole);
  const have = new Set([...(resume?.skills || []), ...findSkills(resumeToText(resume))].map((s) => s.toLowerCase()));
  return {
    field,
    suggestions: (FIELD_SKILLS[field] || FIELD_SKILLS.general)
      .filter(([skill]) => !have.has(skill.toLowerCase()))
      .map(([skill, how]) => ({ skill, how })),
  };
}

// Keeps only AI-reported skills whose quoted evidence really appears in the
// resume text. Returns { verified, dropped }.
export function verifyAiSkills(skills, resumeText) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const haystack = norm(resumeText);
  const verified = [];
  let dropped = 0;
  for (const s of skills || []) {
    const quote = norm(s?.evidence);
    if (s?.name && quote.length >= 8 && haystack.includes(quote)) verified.push({ name: String(s.name), evidence: String(s.evidence) });
    else dropped += 1;
  }
  return { verified, dropped };
}
