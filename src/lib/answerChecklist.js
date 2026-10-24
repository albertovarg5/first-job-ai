// Automated answer checklist used when AI feedback is not connected.
// It checks structure (length, STAR, specifics, ownership) with simple text
// rules. The interface labels it "Automated checklist", never as AI feedback.
import { wordCount } from './utils.js';

const STOP = new Set(
  'a an the and or but to of in on for with at by from about as is are was were be been it this that you your me my i we our they them what how why when where who which do did does tell describe time would can could should have has had there their its so if into than then'.split(
    ' ',
  ),
);

function contentWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

export function checkAnswer({ question, answer, category }) {
  const text = String(answer || '');
  const lower = ` ${text.toLowerCase()} `;
  const words = wordCount(text);
  const checks = [];

  if (words < 40) {
    checks.push({ label: 'Length', passed: false, tip: `Your answer is ${words} words. Aim for about 80–200 words (roughly 1–2 minutes spoken).` });
  } else if (words > 300) {
    checks.push({ label: 'Length', passed: false, tip: `Your answer is ${words} words. Trim it toward 200 so it stays focused.` });
  } else {
    checks.push({ label: 'Length', passed: true, tip: `${words} words — a good length for a spoken answer.` });
  }

  if (category === 'behavioral') {
    const situation = /\b(when|while|during|at my|in my|last (year|semester|summer)|once|one time)\b/.test(lower);
    const action = (lower.match(/\bi (\w+ed|made|built|wrote|led|took|set|ran|spoke|met|told|chose|decided|asked|created|organized|helped)\b/g) || []).length > 0;
    const result = /\b(result|as a result|in the end|outcome|ended up|learned|so that|which meant|because of this|finally|eventually|led to)\b/.test(lower);
    checks.push({ label: 'Situation', passed: situation, tip: situation ? 'You set up the context.' : 'Start with the situation: where were you and what was happening?' });
    checks.push({ label: 'Action', passed: action, tip: action ? 'You described actions you took.' : 'Say what you did, using "I" and specific verbs (I organized, I asked, I built).' });
    checks.push({ label: 'Result', passed: result, tip: result ? 'You closed with a result or lesson.' : 'End with what happened because of your actions, or what you learned.' });
  }

  const iCount = (lower.match(/\bi\b/g) || []).length;
  const weCount = (lower.match(/\bwe\b/g) || []).length;
  if (weCount > iCount && weCount > 1) {
    checks.push({ label: 'Your role', passed: false, tip: `You said "we" ${weCount} times and "I" ${iCount} times. Interviewers want to hear what you did.` });
  } else if (words >= 20) {
    checks.push({ label: 'Your role', passed: true, tip: 'Your own contribution comes through.' });
  }

  const specific = /\d/.test(text) || /\b[A-Z][a-zA-Z]+\b/.test(text.replace(/^\s*\w+|[.!?]\s+\w+/g, ''));
  checks.push({
    label: 'Specific details',
    passed: specific,
    tip: specific ? 'You included concrete details (names, tools or numbers).' : 'Add one concrete detail: a tool, a class, a place or a real number.',
  });

  const fillers = (lower.match(/\b(um|uh|like,|basically|kind of|sort of|stuff|things like that)\b/g) || []).length;
  if (fillers > 1) checks.push({ label: 'Filler words', passed: false, tip: `Found ${fillers} filler words (basically, kind of, stuff…). Cut them for a more confident answer.` });

  const q = new Set(contentWords(question));
  const overlap = contentWords(text).filter((w) => q.has(w)).length;
  if (q.size > 0) {
    checks.push({
      label: 'Answers the question',
      passed: overlap > 0 || words > 60,
      tip: overlap > 0 || words > 60 ? 'Your answer connects to the question.' : 'Re-read the question and make sure your first sentence answers it directly.',
    });
  }

  const passed = checks.filter((c) => c.passed).length;
  return { mode: 'checklist', passed, total: checks.length, checks };
}
