// Ranks job listings against the user's resume and preferences.
// "reasons" are checkable facts (text found in both the resume and the
// posting, or stated by the listing). "checks" are things the user should
// verify. The score is a keyword-based estimate, not a prediction.
import { analyzeJobMatch, findRequirements } from './jobMatch.js';

const STOP = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'at', 'with', 'jr', 'sr', 'i', 'ii', 'iii']);
const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 1 && !STOP.has(w));

const listText = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function preferredTypesFromProfile(profile = {}) {
  if (Array.isArray(profile.preferredTypes) && profile.preferredTypes.length) return profile.preferredTypes;
  const goals = profile.goals || [];
  const types = [];
  if (goals.includes('internship') || profile.situation === 'internship') types.push('INTERN');
  if (goals.includes('full-time')) types.push('FULLTIME');
  if (goals.includes('part-time')) types.push('PARTTIME');
  return types;
}

export function scoreJob(job, { resume, profile = {} }) {
  const text = [job.description, ...Object.values(job.highlights || {}).flat()].join('\n');
  const match = analyzeJobMatch(resume, text);
  const reasons = [];
  const checks = [];
  let score = 0;

  if (match.matched.length) {
    reasons.push(`Your resume shows ${listText(match.matched.slice(0, 5))}, which the posting also mentions.`);
  }
  if (match.jobSkills.length) score += (match.matched.length / match.jobSkills.length) * 50;

  const target = words(profile.targetRole);
  const titleWords = new Set(words(job.title));
  const overlap = target.filter((w) => titleWords.has(w));
  if (target.length && overlap.length) {
    reasons.push(`The job title shares “${overlap.join(' ')}” with your target role (${profile.targetRole}).`);
    score += 25 * (overlap.length / target.length);
  }

  const haystack = `${job.title}\n${text}`.toLowerCase();
  const interests = (profile.interests || []).filter((i) => i.trim() && haystack.includes(i.trim().toLowerCase()));
  if (interests.length) {
    reasons.push(`Mentions your interest${interests.length > 1 ? 's' : ''}: ${listText(interests)}.`);
    score += 10;
  }

  if (job.experience?.noExperienceRequired) {
    reasons.push('The listing says no experience is required.');
    score += 10;
  } else if (job.experience?.months > 36) {
    checks.push(`The listing asks for about ${Math.round(job.experience.months / 12)} years of experience.`);
    score -= 15;
  }

  const types = preferredTypesFromProfile(profile);
  if (types.length && job.employmentTypes?.some((t) => types.includes(t))) {
    reasons.push('Matches the type of job you said you want.');
    score += 5;
  }
  if (profile.remoteOnly && job.isRemote) reasons.push('Listed as remote, as you prefer.');
  if (profile.remoteOnly && !job.isRemote) checks.push('Not listed as remote.');

  if (match.missing.length) checks.push(`The posting mentions ${listText(match.missing.slice(0, 5))}, which your resume doesn’t show.`);
  for (const req of findRequirements(text)) {
    if (req.type === 'years' || req.type === 'degree' || req.type === 'certification' || req.type === 'license') checks.push(`Requirement to check: “${req.label}”.`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, checks: [...new Set(checks)].slice(0, 5), matched: match.matched };
}

export function rankJobs(jobs, context) {
  return jobs
    .map((job) => ({ job, ...scoreJob(job, context) }))
    .sort((a, b) => b.score - a.score);
}
