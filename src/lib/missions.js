// Daily Career Missions: three small tasks per day, picked from a pool
// based on the date and on what the user still needs to do.
import { toDateKey, parseDateKey, addDays } from './utils.js';

export const MISSIONS = [
  { id: 'improve-bullet', area: 'resume', title: 'Improve one resume bullet', description: 'Pick your weakest bullet and rewrite it to start with a strong action verb.', to: '/resume', minutes: 10 },
  { id: 'write-summary', area: 'resume', title: 'Write a professional summary', description: 'Two or three sentences: who you are, what you are good at, and the role you want.', to: '/resume', minutes: 15 },
  { id: 'add-project', area: 'resume', title: 'Add a project to your resume', description: 'A class project, personal project or volunteer project counts. Describe what you built or did.', to: '/resume', minutes: 15 },
  { id: 'add-skills', area: 'resume', title: 'List five skills you can prove', description: 'Add skills you could talk about with an example, not just ones that sound good.', to: '/resume', minutes: 10 },
  { id: 'tailor-resume', area: 'resume', title: 'Compare your resume to a job post', description: 'Paste a real job description into the tailoring tool and note what is missing.', to: '/resume?tab=tailor', minutes: 15 },
  { id: 'translate-experience', area: 'resume', title: 'Translate one experience', description: 'Turn a school, volunteer or part-time experience into resume language.', to: '/translator', minutes: 10 },
  { id: 'find-five-jobs', area: 'search', title: 'Find five jobs that match your skills', description: 'Search a job board and save five postings to your tracker as "Interested".', to: '/tracker', minutes: 25 },
  { id: 'apply-one', area: 'search', title: 'Apply to one job', description: 'Choose your best match, tailor your resume and submit. Then mark it "Applied".', to: '/tracker', minutes: 45 },
  { id: 'update-tracker', area: 'search', title: 'Update your application tracker', description: 'Check your email and update the status of every application.', to: '/tracker', minutes: 10 },
  { id: 'research-company', area: 'search', title: 'Research one company', description: 'Read a company’s About page and add three notes to its tracker entry.', to: '/tracker', minutes: 15 },
  { id: 'practice-three', area: 'interview', title: 'Practice three interview questions', description: 'Answer three questions in writing and read the feedback.', to: '/interview', minutes: 20 },
  { id: 'practice-behavioral', area: 'interview', title: 'Practice a "Tell me about a time" answer', description: 'Use the STAR method: situation, task, action, result.', to: '/interview', minutes: 15 },
  { id: 'intro-pitch', area: 'interview', title: 'Write a professional introduction', description: 'A 30-second answer to "Tell me about yourself". Practice it out loud twice.', to: '/interview', minutes: 15 },
  { id: 'questions-for-them', area: 'interview', title: 'Prepare three questions to ask an interviewer', description: 'Good questions show interest: ask about the team, the first 90 days or how success is measured.', to: null, minutes: 10 },
  { id: 'linkedin-headline', area: 'network', title: 'Update your LinkedIn headline', description: 'Say what you are studying or looking for, for example "Marketing student seeking summer internship".', to: null, minutes: 10 },
  { id: 'message-contact', area: 'network', title: 'Message one person in your field', description: 'Ask a friendly, specific question about their job. Keep it short.', to: null, minutes: 15 },
  { id: 'career-center', area: 'network', title: 'Book time with a career advisor', description: 'Your school career center or a local job center can review your resume for free.', to: null, minutes: 10 },
  { id: 'portfolio-piece', area: 'resume', title: 'Add one piece to your portfolio', description: 'Upload a project, writing sample or design to a portfolio site or GitHub, then add the link to your resume.', to: '/resume', minutes: 30 },
];

export const AREA_LABELS = {
  resume: 'Resume',
  search: 'Job search',
  interview: 'Interviews',
  network: 'Networking',
};

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// context: { resumeCompleteness, applicationCount, practiceCount }
export function dailyMissions(dateKey = toDateKey(), context = {}) {
  const { resumeCompleteness = 0, applicationCount = 0, practiceCount = 0 } = context;
  const priority = [];
  if (resumeCompleteness < 70) priority.push(resumeCompleteness < 30 ? 'add-skills' : 'write-summary');
  if (applicationCount === 0) priority.push('find-five-jobs');
  if (practiceCount === 0) priority.push('practice-three');

  const day = hashString(dateKey);
  const rotated = [...MISSIONS].sort((a, b) => hashString(a.id + dateKey) - hashString(b.id + dateKey));
  const picks = [];
  // At most one priority mission per day so days still feel varied.
  if (priority.length) picks.push(priority[day % priority.length]);
  for (const m of rotated) {
    if (picks.length >= 3) break;
    if (picks.includes(m.id)) continue;
    // Avoid three missions from the same area.
    const areas = picks.map((id) => MISSIONS.find((x) => x.id === id).area);
    if (areas.filter((a) => a === m.area).length >= 1 && picks.length < 2) continue;
    picks.push(m.id);
  }
  return picks.map((id) => MISSIONS.find((m) => m.id === id));
}

// completed: { 'YYYY-MM-DD': ['mission-id', ...] }
export function missionStats(completed = {}, today = new Date()) {
  const todayKey = toDateKey(today);
  const total = Object.values(completed).reduce((sum, ids) => sum + ids.length, 0);

  let streak = 0;
  let cursor = parseDateKey(todayKey);
  if (!(completed[todayKey] || []).length) cursor = addDays(cursor, -1);
  while ((completed[toDateKey(cursor)] || []).length) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const last14 = [];
  for (let i = 13; i >= 0; i -= 1) {
    const key = toDateKey(addDays(parseDateKey(todayKey), -i));
    last14.push({ key, count: (completed[key] || []).length });
  }
  const activeDays = Object.values(completed).filter((ids) => ids.length).length;

  let stage = 'Getting started';
  if (total >= 30) stage = 'Job-search routine';
  else if (total >= 10) stage = 'Building momentum';
  const nextStageAt = total >= 30 ? null : total >= 10 ? 30 : 10;

  return { total, streak, last14, activeDays, stage, nextStageAt };
}
