export const SITUATIONS = [
  { value: 'student', label: 'College student', hint: 'Studying now' },
  { value: 'recent-grad', label: 'Recent graduate', hint: 'Graduated in the last two years' },
  { value: 'internship', label: 'Looking for an internship', hint: 'Summer or semester roles' },
  { value: 'career-change', label: 'Changing careers', hint: 'Moving into a new field' },
  { value: 'new-to-work', label: 'New to the workforce', hint: 'Little or no work history yet' },
];

export const EXPERIENCE_LEVELS = [
  { value: 'none', label: 'No work experience yet', hint: 'School, projects or volunteering only' },
  { value: 'part-time', label: 'Part-time or summer jobs', hint: 'Retail, food service, tutoring…' },
  { value: 'internship', label: 'One or more internships', hint: 'Or co-ops, research positions' },
  { value: 'other-field', label: 'Experience in another field', hint: 'Switching to something new' },
];

export const GOALS = [
  { value: 'internship', label: 'Land an internship' },
  { value: 'full-time', label: 'Get a full-time job' },
  { value: 'part-time', label: 'Find a part-time job' },
  { value: 'resume', label: 'Build a strong resume' },
  { value: 'interviews', label: 'Get better at interviews' },
  { value: 'organize', label: 'Organize my job search' },
];

export const labelFor = (list, value) => list.find((o) => o.value === value)?.label || '';

// One-line focus message used on the dashboard.
export function focusMessage(profile) {
  if (!profile) return '';
  const goals = profile.goals || [];
  const r = profile.targetRole || '';
  const role = r ? ` as ${/^[aeiou]/i.test(r) ? 'an' : 'a'} ${r}` : '';
  if (goals.includes('internship') || profile.situation === 'internship') return `Let’s get you an internship${role}.`;
  if (profile.situation === 'career-change') return `Let’s make your move into a new field${role}.`;
  if (goals.includes('part-time')) return `Let’s find you a part-time role${role}.`;
  return `Let’s get you hired${role}.`;
}
