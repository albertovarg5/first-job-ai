// Compares a job description with the user's resume using a skills
// dictionary and simple requirement detection. No AI involved.
import { resumeToText, resumeChecklist, resumeCompleteness } from './resume.js';

// Each skill: display name + patterns that count as a mention.
export const SKILLS = [
  // Software & data
  ['JavaScript', ['javascript', 'js']], ['TypeScript', ['typescript']], ['Python', ['python']],
  ['Java', ['java']], ['C++', ['c\\+\\+']], ['C#', ['c#']], ['SQL', ['sql', 'mysql', 'postgresql', 'postgres']],
  ['HTML', ['html']], ['CSS', ['css']], ['React', ['react', 'react.js', 'reactjs']], ['Node.js', ['node.js', 'nodejs', 'node']],
  ['Git', ['git', 'github']], ['APIs', ['api', 'apis', 'rest api', 'restful']], ['AWS', ['aws', 'amazon web services']],
  ['Cloud', ['cloud', 'azure', 'gcp', 'google cloud']], ['Linux', ['linux']], ['Testing', ['testing', 'unit tests', 'qa']],
  ['Machine learning', ['machine learning', 'ml']], ['Data analysis', ['data analysis', 'analyze data', 'analyzing data', 'data analytics']],
  ['Excel', ['excel', 'spreadsheets', 'spreadsheet']], ['Tableau', ['tableau']], ['Power BI', ['power bi']],
  ['Statistics', ['statistics', 'statistical']], ['Data visualization', ['data visualization', 'dashboards', 'dashboard']],
  ['R', ['r programming', 'rstudio']],
  // Design & marketing
  ['Figma', ['figma']], ['Adobe Creative Suite', ['adobe', 'photoshop', 'illustrator', 'indesign']], ['Canva', ['canva']],
  ['UX research', ['user research', 'ux research', 'usability']], ['Social media', ['social media', 'instagram', 'tiktok', 'linkedin content']],
  ['SEO', ['seo', 'search engine optimization']], ['Content creation', ['content creation', 'content writing', 'copywriting', 'create content']],
  ['Google Analytics', ['google analytics']], ['Email marketing', ['email marketing', 'mailchimp']], ['Marketing', ['marketing']],
  // Business
  ['Salesforce', ['salesforce']], ['CRM', ['crm']], ['Sales', ['sales', 'selling']], ['Accounting', ['accounting', 'bookkeeping']],
  ['QuickBooks', ['quickbooks']], ['Budgeting', ['budget', 'budgeting', 'budgets']], ['Project management', ['project management', 'manage projects', 'project coordination']],
  ['Agile', ['agile', 'scrum', 'kanban']], ['Microsoft Office', ['microsoft office', 'ms office', 'microsoft word', 'powerpoint', 'microsoft outlook']],
  ['Google Workspace', ['google workspace', 'google sheets', 'google docs', 'g suite']],
  ['Scheduling', ['scheduling', 'calendar management']], ['Data entry', ['data entry']], ['Research', ['research', 'researching']],
  // Service, ops, healthcare
  ['Customer service', ['customer service', 'customer support', 'client service', 'customer-facing', 'guest service']],
  ['Cash handling', ['cash handling', 'cash register', 'pos', 'point of sale']], ['Inventory', ['inventory', 'stocking']],
  ['Patient care', ['patient care', 'patients']], ['CPR / First aid', ['cpr', 'first aid', 'bls']], ['Food safety', ['food safety', 'food handler']],
  ['Tutoring', ['tutoring', 'tutor', 'tutored']], ['Teaching', ['teaching', 'lesson planning', 'classroom']],
  // Professional skills
  ['Communication', ['communication', 'communicate', 'communicating', 'communicated']], ['Teamwork', ['teamwork', 'team player', 'collaborat\\w*']],
  ['Leadership', ['leadership', 'lead', 'led', 'leading']], ['Problem solving', ['problem solving', 'problem-solving', 'solve problems', 'troubleshoot\\w*']],
  ['Time management', ['time management', 'prioritize', 'prioritization', 'deadlines']], ['Attention to detail', ['attention to detail', 'detail-oriented', 'detail oriented']],
  ['Writing', ['writing', 'written communication', 'wrote', 'write']], ['Public speaking', ['public speaking', 'presentations', 'presenting', 'presented']],
  ['Organization', ['organized', 'organizational', 'organization skills', 'organizing']], ['Adaptability', ['adaptable', 'adaptability', 'fast-paced', 'fast paced']],
  ['Critical thinking', ['critical thinking', 'analytical']], ['Bilingual', ['bilingual']], ['Spanish', ['spanish']],
  ['Microsoft Excel', ['vlookup', 'pivot table', 'pivot tables']],
].map(([name, patterns]) => ({
  name,
  re: new RegExp(`(?:^|[^a-z0-9+#])(?:${patterns.join('|')})(?=$|[^a-z0-9+#])`, 'i'),
}));

export function findSkills(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  return SKILLS.filter((s) => s.re.test(t)).map((s) => s.name);
}

// Requirement-style lines: years, degrees, certifications, licenses, availability.
export function findRequirements(jobText) {
  const text = String(jobText || '');
  const reqs = [];
  const years = text.match(/(\d+)\s*\+?\s*(?:-\s*\d+\s*)?years?(?: of)?(?: [a-z-]+){0,3} experience/i);
  if (years) reqs.push({ type: 'years', label: years[0].trim(), years: Number(years[1]) });
  const degree = text.match(/\b(bachelor'?s?|master'?s?|associate'?s?|ph\.?d|high school diploma|ged|degree)\b[^.\n]{0,60}/i);
  if (degree) reqs.push({ type: 'degree', label: degree[0].trim() });
  const cert = text.match(/\b(certification|certified|certificate|license|licensed)\b[^.\n]{0,50}/i);
  if (cert) reqs.push({ type: 'certification', label: cert[0].trim() });
  if (/driver'?s licen[sc]e/i.test(text)) reqs.push({ type: 'license', label: "Driver's license" });
  if (/\b(weekends?|evenings?|night shifts?|flexible schedule)\b/i.test(text)) {
    reqs.push({ type: 'availability', label: 'Specific availability (evenings, weekends or shifts)' });
  }
  return reqs;
}

function hasDegree(resume) {
  return (resume?.education || []).some((e) => (e.degree || '').trim() || (e.school || '').trim());
}

export function analyzeJobMatch(resume, jobDescription) {
  const resumeText = resumeToText(resume);
  const jobSkills = findSkills(jobDescription);
  const resumeSkillNames = new Set([
    ...findSkills(resumeText),
    ...(resume?.skills || []).flatMap((s) => findSkills(s).concat(s)),
  ].map((s) => s.toLowerCase()));

  const matched = jobSkills.filter((s) => resumeSkillNames.has(s.toLowerCase()));
  const missing = jobSkills.filter((s) => !resumeSkillNames.has(s.toLowerCase()));
  const score = jobSkills.length ? Math.round((matched.length / jobSkills.length) * 100) : 0;

  const qualifications = findRequirements(jobDescription).map((req) => {
    let note;
    if (req.type === 'degree') {
      note = hasDegree(resume)
        ? 'Make sure your degree (or expected graduation date) is clear in Education.'
        : 'Your resume has no education yet. Add it if you have or are working toward a degree.';
    } else if (req.type === 'years') {
      note = 'Count internships, part-time jobs and substantial projects honestly. Many entry-level postings are flexible on years.';
    } else if (req.type === 'certification' || req.type === 'license') {
      note = 'If you hold this, list it under Achievements. If not, the posting may still be worth applying to.';
    } else {
      note = 'Mention your availability in your application or cover letter if it fits.';
    }
    return { ...req, note };
  });

  const suggestions = [];
  if (missing.length) {
    suggestions.push(
      `The posting mentions ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' and more' : ''}. If you have used any of these, add them to Skills and show where you used them in a bullet.`,
    );
  }
  if (matched.length) {
    suggestions.push(
      `You already show ${matched.slice(0, 3).join(', ')}. Put the bullets that prove these near the top of each entry.`,
    );
  }
  const unfinished = resumeChecklist(resume).filter((i) => !i.done);
  if (unfinished.length) suggestions.push(`Finish your resume basics: ${unfinished[0].label.toLowerCase()}.`);
  if (!(resume?.summary || '').trim()) {
    suggestions.push('Write a 2–3 sentence summary that names the kind of role in this posting.');
  }
  if (!jobSkills.length) {
    suggestions.push('No common skills were recognized in this description. Paste the full posting, including the requirements section.');
  }
  suggestions.push('Only add skills and experience you really have. Interviewers will ask about anything on your resume.');

  return {
    jobSkills,
    matched,
    missing,
    score,
    qualifications,
    suggestions,
    completeness: resumeCompleteness(resume),
  };
}
