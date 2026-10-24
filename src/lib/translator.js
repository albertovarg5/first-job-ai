// Basic-mode Experience Translator.
// Rewrites plain-language descriptions into resume-style bullets using
// predictable rules. It only rephrases what the user wrote: it never adds
// numbers, results, tools or responsibilities that are not in the input.

const NUMBER_WORDS = [
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'fifteen', 'twenty',
];

const TEAM_NOUNS =
  'people|students|classmates|friends|teammates|members|volunteers|coworkers|co-workers|others|peers';

// Past-tense verb -> base form, used for "Collaborated with ... to <verb>".
const PAST_TO_BASE = {
  created: 'develop',
  made: 'create',
  built: 'build',
  developed: 'develop',
  designed: 'design',
  wrote: 'write',
  coded: 'code',
  programmed: 'program',
  organized: 'organize',
  planned: 'plan',
  presented: 'present',
  researched: 'research',
  analyzed: 'analyze',
  launched: 'launch',
  produced: 'produce',
  prepared: 'prepare',
  ran: 'run',
  hosted: 'host',
  taught: 'teach',
  tested: 'test',
  filmed: 'film',
  edited: 'edit',
  painted: 'paint',
  raised: 'raise',
  collected: 'collect',
  delivered: 'deliver',
};

// Base verbs that can follow "helped" ("helped organize an event").
const HELP_VERBS = new Set([
  'organize', 'run', 'plan', 'set', 'create', 'build', 'teach', 'manage', 'coordinate',
  'prepare', 'clean', 'sell', 'cook', 'serve', 'design', 'write', 'develop', 'train',
  'raise', 'collect', 'host', 'make', 'test', 'launch', 'answer', 'sort', 'pack', 'tutor',
]);

// Verbs that can follow an object after "helped" ("helped customers find").
const FOLLOW_VERBS = new Set([
  'find', 'learn', 'understand', 'choose', 'get', 'solve', 'improve', 'navigate', 'complete', 'finish',
  'use', 'apply', 'pick', 'select', 'study', 'practice', 'read', 'open', 'return',
]);

// Ordered phrase rules. Each one only changes wording, never meaning.
const PHRASE_RULES = [
  [/\b(?:basically|kind of|sort of|really|very|just|actually|literally)\s+/gi, ''],
  [/\ba lot of\b|\blots of\b/gi, 'many'],
  [/\b(?:a|the|my|our) (?:school|class|college|university) project\b/gi, 'an academic project'],
  [/\b(?:school|class) project\b/gi, 'academic project'],
  [/\bfor (?:school|class)\b/gi, 'for a course'],
  [/\b(?:my|our) (team|group|class|manager|supervisor|club|professor|teacher|school|company|store|church|community)\b/gi, 'the $1'],
  [/\btalked (?:to|with)\b/gi, 'communicated with'],
  [/\bwas in charge of\b/gi, 'led'],
  [/\bwas responsible for\b/gi, 'responsible for'],
  [/\bgot promoted\b/gi, 'promoted'],
  [/\bgot (an?|the) (award|scholarship|certificate|certification|prize)\b/gi, 'earned $1 $2'],
  [/\bstuff\b/gi, 'tasks'],
  [/\band did\b/gi, 'and completed'],
];

const LEADING_VERB_RULES = [
  [/^worked on\b/i, 'Contributed to'],
  [/^did\b/i, 'Completed'],
  [/^made\b/i, 'Created'],
  // "helped organize X" and "helped customers find X" stay "Helped"; "helped customers" -> "Assisted customers".
  [/^helped (?:to )?(\w+)(?: (\w+))?/i, (m, w, next) => {
    const followedByVerb = next && (HELP_VERBS.has(next.toLowerCase()) || FOLLOW_VERBS.has(next.toLowerCase()));
    if (HELP_VERBS.has(w.toLowerCase()) || followedByVerb) return `Helped ${m.slice(m.indexOf(' ') + 1)}`;
    return `Assisted ${m.slice(m.indexOf(' ') + 1)}`;
  }],
  [/^was an? (.+?) at (.+)$/i, 'Worked as a $1 at $2'],
  [/^was an? (.+)$/i, 'Served as a $1'],
  [/^was part of\b/i, 'Participated in'],
  [/^got\b/i, 'Earned'],
];

function cleanSentence(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–•*]+/, '')
    .replace(/[.!?;,\s]+$/, '')
    .trim();
}

function stripSubject(s) {
  // Resume bullets drop "I" / "We" at the start.
  return s.replace(/^(?:i|we|i've|we've|i have|we have)\s+/i, '');
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// "with three people" -> "with a three-person team" (same meaning).
// "with five volunteers" keeps the noun, since it says who they were.
function teamPhrase(countWord, hasOther, noun) {
  if (/^(people|others)$/.test(noun) && !hasOther) return `with a ${countWord}-person team`;
  return `alongside ${countWord} ${hasOther ? 'other ' : ''}${noun}`;
}

const TEAM_RE = new RegExp(
  `\\bwith (\\d+|${NUMBER_WORDS.join('|')}) (other )?(${TEAM_NOUNS})\\b`,
  'i',
);

// Special case: "<did something> with N people and <verb> <object>"
// -> "Collaborated with a N-person team to <verb> <object> as part of <something>."
function tryCollaborationPattern(s) {
  const m = s.match(
    new RegExp(
      `^(?:worked on|did|was part of|participated in|took part in) (.+?) with (\\d+|${NUMBER_WORDS.join('|')}) (other )?(${TEAM_NOUNS}) (?:and|to) (\\w+) (.+)$`,
      'i',
    ),
  );
  if (!m) return null;
  const [, context, count, other, noun, verb, rest] = m;
  const base = PAST_TO_BASE[verb.toLowerCase()];
  if (!base) return null;
  const n = noun.toLowerCase();
  const who = /^(people|others)$/.test(n) && !other ? `a ${count.toLowerCase()}-person team` : `${count.toLowerCase()} ${other ? 'other ' : ''}${n}`;
  return `Collaborated with ${who} to ${base} ${rest} as part of ${context}`;
}

// "me and my friends made X" / "my friends and I made X"
function tryWithOthersPattern(s) {
  const m =
    s.match(/^me and (my )?(\w+) (\w+) (.+)$/i) ||
    s.match(/^(my )?(\w+) and (?:i|me) (\w+) (.+)$/i);
  if (!m) return null;
  const [, my, who, verb, rest] = m;
  const person = `${my ? 'my ' : ''}${who.toLowerCase()}`;
  const base = PAST_TO_BASE[verb.toLowerCase()];
  if (base) return `Collaborated with ${person} to ${base} ${rest}`;
  return `${capitalize(verb.toLowerCase())} ${rest} with ${person}`;
}

export function rewriteSentence(raw) {
  let s = cleanSentence(raw);
  if (!s) return '';
  s = tryWithOthersPattern(s) || stripSubject(s);
  for (const [re, rep] of PHRASE_RULES) s = s.replace(re, rep);

  const collab = tryCollaborationPattern(s);
  if (collab) {
    s = collab;
  } else {
    for (const [re, rep] of LEADING_VERB_RULES) {
      if (re.test(s)) {
        s = s.replace(re, rep);
        break;
      }
    }
    s = s.replace(TEAM_RE, (_m, count, other, noun) =>
      teamPhrase(count.toLowerCase(), Boolean(other), noun.toLowerCase()),
    );
  }
  s = s.replace(/\bi\b/g, 'I');
  return `${capitalize(s)}.`;
}

export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(cleanSentence)
    .filter((s) => s.length > 2);
}

// Questions that help the user add real detail. These are prompts,
// never content inserted into their resume.
export function improvementPrompts(text, category) {
  const t = String(text || '').toLowerCase();
  const prompts = [];
  if (!/\d/.test(t)) {
    prompts.push('Do you know any real numbers (people helped, hours, users, items)? Add them only if they are accurate.');
  }
  if (/\b(we|team|group|together|with \w+ (people|students|classmates))\b/.test(t)) {
    prompts.push('Make your own part clear: what did you personally do on the team?');
  }
  if (['school', 'team', 'personal'].includes(category) && !/\b(using|used|with) [a-z]/.test(t)) {
    prompts.push('Which tools, languages or methods did you use? Naming them helps match job descriptions.');
  }
  if (!/\b(result|so that|which|led to|improv|increas|reduc|won|launched|finished|completed|received|earned)\b/.test(t)) {
    prompts.push('Was there an outcome you can verify (a grade, launch, award, feedback)? Mention it only if it happened.');
  }
  return prompts.slice(0, 3);
}

export function translateExperience(text, category = 'other') {
  const bullets = splitSentences(text).map(rewriteSentence).filter(Boolean);
  return { bullets, prompts: improvementPrompts(text, category) };
}

export const EXPERIENCE_CATEGORIES = [
  { value: 'school', label: 'School project' },
  { value: 'volunteer', label: 'Volunteer activity' },
  { value: 'job', label: 'Part-time job' },
  { value: 'team', label: 'Team project' },
  { value: 'leadership', label: 'Leadership role' },
  { value: 'personal', label: 'Personal project' },
  { value: 'other', label: 'Something else' },
];
