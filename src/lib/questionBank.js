// Built-in library of sample interview questions. These are written examples,
// not AI-generated, and the interface labels them that way.

export const INTERVIEW_TYPES = [
  { value: 'general', label: 'General', hint: 'Common opening and closing questions' },
  { value: 'behavioral', label: 'Behavioral', hint: '"Tell me about a time…" questions — use the STAR method' },
  { value: 'technical', label: 'Role-specific', hint: 'Questions about skills for the job title you chose' },
  { value: 'mixed', label: 'Mixed', hint: 'A bit of everything, like a real first-round interview' },
];

export const GENERAL_QUESTIONS = [
  'Tell me about yourself.',
  'Why are you interested in this role?',
  'Why do you want to work at our company?',
  'What are your greatest strengths?',
  'What is one area you are working to improve?',
  'Where do you see yourself in two to three years?',
  'What do you know about what this role involves day to day?',
  'Why should we hire you, even with limited work experience?',
  'What kind of work environment helps you do your best?',
  'Do you have any questions for us?',
];

export const BEHAVIORAL_QUESTIONS = [
  'Tell me about a time you worked on a team to complete a project.',
  'Describe a time you faced a difficult problem. How did you solve it?',
  'Tell me about a time you made a mistake. What did you learn?',
  'Describe a situation where you had to learn something new quickly.',
  'Tell me about a time you disagreed with someone. How did you handle it?',
  'Give an example of a time you managed several deadlines at once.',
  'Tell me about a time you took initiative without being asked.',
  'Describe a time you received critical feedback. What did you do with it?',
  'Tell me about a goal you set and how you achieved it.',
  'Describe a time you helped someone who was struggling.',
  'Tell me about a time you had to explain something complex to someone.',
  'Describe a situation where you had to adapt to a sudden change.',
];

const TECHNICAL = {
  software: [
    'Walk me through a project you built. What would you do differently now?',
    'How do you approach debugging a problem you have never seen before?',
    'Explain the difference between a list and a dictionary (or array and object).',
    'What happens when you type a URL into a browser and press Enter?',
    'How do you make sure your code works before you share it?',
    'How would you explain an API to someone who does not code?',
    'How do you use Git when working with other people?',
    'Tell me about a technical concept you learned recently.',
  ],
  data: [
    'Walk me through how you would clean a messy dataset.',
    'How would you explain the difference between mean and median, and when each is useful?',
    'What steps would you take to answer a business question with data?',
    'How would you present findings to someone who is not technical?',
    'What is a SQL JOIN, and when would you use one?',
    'How do you check whether your analysis is correct?',
    'Which chart would you use to show change over time, and why?',
  ],
  design: [
    'Walk me through your design process on a recent project.',
    'How do you gather feedback on a design and decide what to change?',
    'How do you make a design accessible to more people?',
    'Tell me about a design decision you made and why.',
    'How do you balance user needs with business or project constraints?',
    'Which design tools are you most comfortable with, and how have you used them?',
  ],
  marketing: [
    'How would you promote a new product with a small budget?',
    'Which metrics would you look at to judge if a social media post worked?',
    'Tell me about a brand whose marketing you admire and why.',
    'How would you write a message for two different audiences?',
    'How do you stay current with marketing trends?',
    'Walk me through how you would plan a simple campaign.',
  ],
  business: [
    'How would you organize a project with several deadlines and stakeholders?',
    'Tell me how you would analyze whether a new idea is worth pursuing.',
    'How comfortable are you with spreadsheets? Describe something you built.',
    'How would you handle a client or customer who is unhappy?',
    'What does good communication with a manager look like to you?',
    'How do you prioritize when everything seems urgent?',
  ],
  finance: [
    'Walk me through the three main financial statements.',
    'How would you check a spreadsheet for errors?',
    'Why does attention to detail matter in finance roles?',
    'Tell me about a time you worked carefully with numbers.',
    'How would you explain a budget to someone without a finance background?',
    'What financial news or trend have you followed recently?',
  ],
  healthcare: [
    'How do you stay calm and focused in a stressful situation?',
    'How would you handle a patient or family member who is upset?',
    'Why is patient privacy important, and how would you protect it?',
    'Tell me about a time you followed a procedure carefully.',
    'How do you communicate with people from different backgrounds?',
    'What drew you to working in healthcare?',
  ],
  education: [
    'How would you help a student who is falling behind?',
    'Describe how you would explain a difficult concept in a simple way.',
    'How would you manage a group that is losing focus?',
    'How do you adapt your approach for different learning styles?',
    'Tell me about a time you helped someone learn something.',
  ],
  service: [
    'How would you handle a customer who is angry about a mistake that was not your fault?',
    'What does great customer service mean to you?',
    'How do you stay productive during a slow shift?',
    'How would you handle a long line and a phone ringing at the same time?',
    'Tell me about a time you went out of your way to help someone.',
    'How do you work with coworkers when the team is short-staffed?',
  ],
  general: [
    'Which skills from school or past roles will help you most in this job?',
    'Walk me through how you would approach your first month in this role.',
    'Which tools or software have you used that relate to this job?',
    'Tell me about a project that shows you can do this kind of work.',
    'How do you learn a new tool or process at work?',
    'What questions would you ask your manager in your first week?',
  ],
};

const FIELD_KEYWORDS = [
  ['software', /develop|engineer|software|programm|web|frontend|front-end|backend|full.?stack|it support|devops|qa/i],
  ['data', /data|analyst|analytics|scien|research assistant|bi\b/i],
  ['design', /design|ux|ui\b|graphic|product designer|creative/i],
  ['marketing', /market|social media|content|brand|communications|seo|pr\b|public relations/i],
  ['finance', /financ|account|bank|audit|tax|investment/i],
  ['healthcare', /nurs|medical|health|clinic|patient|pharma|care assistant|dental|therap/i],
  ['education', /teach|tutor|educat|school|instructor|coach/i],
  ['service', /retail|cashier|barista|server|host|customer|sales associate|store|restaurant|front desk|reception|call center/i],
  ['business', /business|operations|project|coordinator|admin|assistant|consult|manager|hr\b|human resources|recruit|sales/i],
];

export function fieldForTitle(title) {
  const t = String(title || '');
  for (const [field, re] of FIELD_KEYWORDS) if (re.test(t)) return field;
  return 'general';
}

function shuffle(list, seed) {
  // Deterministic shuffle when a seed is passed (used by tests).
  const arr = [...list];
  let s = seed ?? Math.floor(Math.random() * 1e9);
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildQuestionSet({ jobTitle, type, count = 5, seed }) {
  const field = fieldForTitle(jobTitle);
  const technical = TECHNICAL[field];
  const tag = (list, category) => list.map((question) => ({ question, category }));
  let pool;
  if (type === 'general') pool = shuffle(tag(GENERAL_QUESTIONS.slice(1), 'general'), seed);
  else if (type === 'behavioral') pool = shuffle(tag(BEHAVIORAL_QUESTIONS, 'behavioral'), seed);
  else if (type === 'technical') pool = shuffle(tag(technical, 'technical'), seed);
  else {
    const g = shuffle(tag(GENERAL_QUESTIONS.slice(1), 'general'), seed);
    const b = shuffle(tag(BEHAVIORAL_QUESTIONS, 'behavioral'), seed);
    const t = shuffle(tag(technical, 'technical'), seed);
    pool = [];
    for (let i = 0; pool.length < count + 3 && i < 12; i += 1) {
      [b[i], t[i], g[i]].forEach((q) => q && pool.push(q));
    }
  }
  // "Tell me about yourself" is how most real interviews start.
  const opener = { question: GENERAL_QUESTIONS[0], category: 'general' };
  const set = type === 'general' || type === 'mixed' ? [opener, ...pool] : pool;
  return { field, questions: set.slice(0, count) };
}
