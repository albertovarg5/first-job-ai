// Server-side AI route for First Job AI.
//
// This file runs in Node (inside the Vite dev/preview server), NOT in the
// browser. Your API key is read from the .env file here and is never sent to
// the browser. The browser only talks to /api/ai/* on your own computer.
//
// Routes:
//   GET  /api/ai/status     -> { connected, model, error }
//   POST /api/ai/translate  -> { bullets: string[] }
//   POST /api/ai/feedback   -> { summary, strengths[], improvements[], nextStep }
//   POST /api/ai/tailor     -> { suggestions: string[] }
//   POST /api/ai/coverLetter -> { letter, gaps[] }
//   POST /api/ai/questions  -> { questions: [{ question, category }] }
//   POST /api/ai/skills     -> { skills: [{ name, evidence }], suggestions: [{ title, detail }] }
//   POST /api/ai/summary    -> { summary }

const HONESTY_RULES = `Rules you must always follow:
- Use only facts the user provided. Never invent numbers, percentages, results, tools, employers, titles, dates, responsibilities or achievements.
- If something useful is missing, say what the user could add instead of making it up.
- Write in clear, plain English suitable for an entry-level job seeker.
- Respond with JSON only, no markdown fences.`;

const TASKS = {
  translate: {
    maxTokens: 700,
    system: `You turn everyday descriptions of experiences into professional resume bullet points for students and early-career job seekers.
${HONESTY_RULES}
Return: {"bullets": ["..."]} with 1 to 4 bullets. Each bullet starts with a strong past-tense action verb (present tense if the activity is ongoing), is one sentence, and keeps every fact from the input without adding new ones.`,
    user: ({ text, category }) => `Experience type: ${category || 'not specified'}\nUser's description:\n"""${text}"""`,
    validate: (j) => Array.isArray(j.bullets) && j.bullets.every((b) => typeof b === 'string'),
  },
  feedback: {
    maxTokens: 900,
    system: `You are a supportive, honest interview coach for people applying to their first jobs and internships.
${HONESTY_RULES}
Evaluate the candidate's written answer. For behavioral questions, check the STAR structure (situation, task, action, result).
Return: {"summary": "one or two sentences", "strengths": ["..."], "improvements": ["..."], "example": "...", "nextStep": "one concrete thing to try on the next attempt"}.
Give 1-3 strengths and 1-3 improvements. Quote or reference their actual words.
"example" is a short outline (3-5 lines, e.g. "Situation: ...") showing how THEIR answer could be structured better, using only details they wrote. Where a detail is missing, write a bracketed prompt such as [what was the result?] instead of inventing it.`,
    user: ({ question, answer, jobTitle, category }) =>
      `Target job: ${jobTitle || 'not specified'}\nQuestion type: ${category}\nQuestion: ${question}\nCandidate's answer:\n"""${answer}"""`,
    validate: (j) => typeof j.summary === 'string' && Array.isArray(j.strengths) && Array.isArray(j.improvements),
  },
  tailor: {
    maxTokens: 900,
    system: `You help entry-level candidates tailor their resume to a specific job posting.
${HONESTY_RULES}
Compare the resume with the job description. Suggest how to better present experience the candidate ALREADY has (reordering, rewording, emphasizing relevant coursework or projects). If the job needs something the resume does not show, say so plainly and suggest adding it only if they genuinely have it.
Return: {"suggestions": ["..."]} with 3 to 6 specific suggestions.`,
    user: ({ resumeText, jobDescription }) => `RESUME:\n"""${resumeText}"""\n\nJOB DESCRIPTION:\n"""${jobDescription}"""`,
    validate: (j) => Array.isArray(j.suggestions),
  },
  coverLetter: {
    maxTokens: 1500,
    system: `You write cover letters for students and early-career job seekers.
${HONESTY_RULES}
Use ONLY experience, education, skills and achievements that appear in the candidate's resume or notes. Never claim the candidate has a skill, tool, qualification or result that is not written there, even if the job asks for it.
If the job requires something the candidate does not show, do not mention it as a strength; list it in "gaps" instead.
Write 3-4 short paragraphs (under 350 words total), addressed "Dear Hiring Manager," unless a name is given, and end with "Sincerely," followed by a new line with [Your name].
Return: {"letter": "full letter text with \n between paragraphs", "gaps": ["requirements from the posting the resume does not show"]}.`,
    user: ({ resumeText, jobTitle, company, jobDescription, notes, tone }) =>
      `Tone: ${tone || 'professional'}
Job title: ${jobTitle}
Company: ${company}

JOB DESCRIPTION:
"""${jobDescription}"""

CANDIDATE RESUME:
"""${resumeText}"""

CANDIDATE'S OWN NOTES (why this job, things to mention):
"""${notes || 'none'}"""`,
    validate: (j) => typeof j.letter === 'string' && j.letter.trim().length > 50 && (j.gaps === undefined || Array.isArray(j.gaps)),
  },
  questions: {
    maxTokens: 1200,
    system: `You are an interviewer preparing realistic first-round interview questions for an entry-level candidate.
${HONESTY_RULES}
Base role-specific questions on the job title and on duties or skills actually written in the job description. Do not assume details the posting does not state.
Each question has a category: "general", "behavioral" (a "Tell me about a time..." question) or "technical" (role-specific skills or knowledge).
Return: {"questions": [{"question": "...", "category": "general|behavioral|technical"}]}.`,
    user: ({ jobTitle, jobDescription, type, count }) =>
      `Job title: ${jobTitle}
Interview type wanted: ${type || 'mixed'} (mixed = a balance of all three categories)
Number of questions: ${count}

JOB DESCRIPTION:
"""${jobDescription || 'not provided'}"""`,
    validate: (j) =>
      Array.isArray(j.questions) &&
      j.questions.length > 0 &&
      j.questions.every((q) => q && typeof q.question === 'string' && ['general', 'behavioral', 'technical'].includes(q.category)),
  },
  skills: {
    maxTokens: 1400,
    system: `You help students and career changers recognize transferable skills in experience they already have.
${HONESTY_RULES}
Identify skills that are clearly supported by the resume text. For each one, "evidence" must be a short exact quote copied from the resume (5-20 words) that shows the skill. If you cannot quote evidence, leave the skill out.
Then suggest practical, realistic ways to strengthen qualifications for the target role (courses, small projects, volunteering, certifications). These are suggestions, not facts about the candidate.
Return: {"skills": [{"name": "...", "evidence": "exact quote"}], "suggestions": [{"title": "...", "detail": "..."}]} with up to 10 skills and 3-5 suggestions.`,
    user: ({ resumeText, targetRole }) => `Target role: ${targetRole || 'not specified'}

RESUME:
"""${resumeText}"""`,
    validate: (j) => Array.isArray(j.skills) && Array.isArray(j.suggestions),
  },
  summary: {
    maxTokens: 500,
    system: `You write the 2-3 sentence summary at the top of an entry-level resume.
${HONESTY_RULES}
Mention the target role, the candidate's education or most relevant experience, and 2-3 skills that appear in the resume. Do not use the words "passionate" or "rockstar". Do not use first person ("I").
Return: {"summary": "..."}.`,
    user: ({ resumeText, targetRole }) => `Target role: ${targetRole || 'not specified'}

RESUME:
"""${resumeText}"""`,
    validate: (j) => typeof j.summary === 'string' && j.summary.trim().length > 20,
  },
};

const MAX_INPUT = 12000;

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function extractJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('The AI response was not in the expected format.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function clip(value) {
  return String(value ?? '').slice(0, MAX_INPUT);
}

export function createAiHandler(env = {}) {
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  const model = (env.AI_MODEL || 'claude-sonnet-5-5').trim();
  const baseUrl = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const hasKey = apiKey.length > 0;

  // Verify the key once (and again after 5 minutes) using the free models list.
  let verified = null; // { at, ok, error }
  async function verifyKey() {
    if (!hasKey) return { ok: false, error: null };
    if (verified && Date.now() - verified.at < 5 * 60 * 1000) return verified;
    try {
      const r = await fetch(`${baseUrl}/v1/models?limit=1`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 401 || r.status === 403) {
        verified = { at: Date.now(), ok: false, error: 'The API key in your .env file was rejected. Check that it was copied correctly.' };
      } else {
        verified = { at: Date.now(), ok: true, error: null };
      }
    } catch {
      // Network problems: don't block AI, the next request will report any error.
      verified = { at: Date.now() - 4 * 60 * 1000, ok: true, error: null };
    }
    return verified;
  }

  async function callModel(task, payload) {
    const def = TASKS[task];
    const input = Object.fromEntries(Object.entries(payload || {}).map(([k, v]) => [k, clip(v)]));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: def.maxTokens,
          system: def.system,
          messages: [{ role: 'user', content: def.user(input) }],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = data?.error?.message || `status ${response.status}`;
        if (response.status === 401) {
          verified = { at: Date.now(), ok: false, error: 'The API key in your .env file was rejected. Check that it was copied correctly.' };
          throw new Error('The API key was rejected. Check ANTHROPIC_API_KEY in your .env file.');
        }
        throw new Error(`The AI service returned an error (${reason}).`);
      }
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const json = extractJson(text);
      if (!def.validate(json)) throw new Error('The AI response was missing expected fields.');
      return json;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The AI service took too long to respond. Try again.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Connect-style middleware: (req, res, next). Mounted at /api/ai.
  return async function aiHandler(req, res, next) {
    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && path === '/status') {
      const v = await verifyKey();
      return send(res, 200, { connected: v.ok, model: v.ok ? model : null, error: v.error });
    }
    const task = path.slice(1);
    if (req.method === 'POST' && TASKS[task]) {
      if (!hasKey) {
        return send(res, 503, { error: 'AI is not connected. Add ANTHROPIC_API_KEY to your .env file and restart the app.' });
      }
      try {
        const payload = await readJson(req);
        const result = await callModel(task, payload);
        return send(res, 200, result);
      } catch (err) {
        return send(res, 502, { error: err.message || 'AI request failed.' });
      }
    }
    if (typeof next === 'function') return next();
    return send(res, 404, { error: 'Not found' });
  };
}
