// Server-side job search through the JSearch API by OpenWeb Ninja.
//
// JSearch is sold in two places, and both work with JSEARCH_API_KEY:
//   - OpenWeb Ninja directly (https://app.openwebninja.com): x-api-key header,
//     GET https://api.openwebninja.com/jsearch/search-v2, cursor pagination.
//   - RapidAPI (https://rapidapi.com): X-RapidAPI-Key header,
//     GET https://jsearch.p.rapidapi.com/search, page-number pagination.
// The provider is detected from the key (RapidAPI keys contain "msh...jsn") or
// set with JSEARCH_PROVIDER=openwebninja|rapidapi.
//
// The key is read from the environment here and never sent to the browser.
// Results are normalized, cached for a while (to save your request
// allowance) and returned with clear error codes when something goes wrong.
//
// Routes (mounted at /api/jobs):
//   GET /status  -> { configured, provider, monthlyLimit, usedThisMonth, country }
//   GET /search  -> { jobs[], page, hasMore, cursor, cached, source }

import { HttpError, pathOf, queryOf, send } from './http.js';

export const DATE_POSTED = ['all', 'today', '3days', 'week', 'month'];
export const EMPLOYMENT_TYPES = ['FULLTIME', 'PARTTIME', 'INTERN', 'CONTRACTOR'];
export const EXPERIENCE = ['', 'no_experience', 'under_3_years_experience', 'more_than_3_years_experience', 'no_degree'];
export const COUNTRIES = ['us', 'ca', 'gb', 'ie', 'au', 'nz', 'in', 'sg', 'de', 'fr', 'es', 'it', 'nl', 'mx', 'br', 'za'];

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 200;
const MAX_PAGE = 20;
const DESCRIPTION_MAX = 20000;
const CURSOR_RE = /^[A-Za-z0-9+/=_.-]{1,500}$/;

export const PROVIDERS = {
  openwebninja: {
    label: 'OpenWeb Ninja',
    baseUrl: 'https://api.openwebninja.com/jsearch',
    path: '/search-v2',
    headers: (key) => ({ 'x-api-key': key }),
    keyHelp: 'your OpenWeb Ninja API key (app.openwebninja.com)',
  },
  rapidapi: {
    label: 'RapidAPI',
    baseUrl: 'https://jsearch.p.rapidapi.com',
    path: '/search',
    headers: (key, host = 'jsearch.p.rapidapi.com') => ({ 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }),
    keyHelp: 'your X-RapidAPI-Key (rapidapi.com, subscribed to JSearch)',
  },
};

// Picks the JSearch provider: an explicit JSEARCH_PROVIDER wins, otherwise a
// RapidAPI-style key ("...msh...jsn...") means RapidAPI, anything else OpenWeb Ninja.
export function resolveProvider(env = {}) {
  const explicit = String(env.JSEARCH_PROVIDER || '').trim().toLowerCase();
  if (PROVIDERS[explicit]) return explicit;
  const key = String(env.JSEARCH_API_KEY || '').trim();
  if (!key && env.RAPIDAPI_KEY) return 'rapidapi';
  return /msh[0-9a-z]+jsn[0-9a-z]+$/i.test(key) ? 'rapidapi' : 'openwebninja';
}

const clean = (v, max) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// Validates and normalizes search input. Throws HttpError(400) on bad input.
export function parseSearchParams(params, { defaultCountry = 'us' } = {}) {
  const get = (k) => (typeof params.get === 'function' ? params.get(k) : params[k]);
  const query = clean(get('query'), 200);
  if (query.length < 2) throw new HttpError(400, 'Enter a job title or keywords (at least 2 characters).', 'invalid_input');
  const location = clean(get('location'), 100);
  const page = Number(get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new HttpError(400, `Page must be a whole number between 1 and ${MAX_PAGE}.`, 'invalid_input');
  }
  const datePosted = clean(get('datePosted'), 10) || 'all';
  if (!DATE_POSTED.includes(datePosted)) throw new HttpError(400, 'Unknown "date posted" filter.', 'invalid_input');
  const experience = clean(get('experience'), 40);
  if (!EXPERIENCE.includes(experience)) throw new HttpError(400, 'Unknown experience filter.', 'invalid_input');
  const typesRaw = clean(get('employmentTypes'), 80);
  const employmentTypes = typesRaw ? typesRaw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) : [];
  if (employmentTypes.some((t) => !EMPLOYMENT_TYPES.includes(t))) throw new HttpError(400, 'Unknown employment type.', 'invalid_input');
  const country = (clean(get('country'), 2) || defaultCountry).toLowerCase();
  if (!COUNTRIES.includes(country)) throw new HttpError(400, 'That country is not supported.', 'invalid_input');
  const remote = /^(1|true)$/i.test(String(get('remote') || ''));
  // Opaque "next page" token from OpenWeb Ninja (only used for page 2+).
  const cursor = String(get('cursor') || '').trim();
  if (cursor && !CURSOR_RE.test(cursor)) throw new HttpError(400, 'The "load more" token is not valid. Start a new search.', 'invalid_input');
  return { query, location, page, cursor: page > 1 ? cursor : '', datePosted, experience, employmentTypes: [...new Set(employmentTypes)].sort(), country, remote };
}

export function buildJSearchUrl(p, { provider = 'rapidapi', baseUrl } = {}) {
  const def = PROVIDERS[provider] || PROVIDERS.rapidapi;
  const url = new URL(`${(baseUrl || def.baseUrl).replace(/\/$/, '')}${def.path}`);
  url.searchParams.set('query', p.location ? `${p.query} in ${p.location}` : p.query);
  if (provider === 'openwebninja') {
    if (p.cursor) url.searchParams.set('cursor', p.cursor);
  } else {
    url.searchParams.set('page', String(p.page));
  }
  url.searchParams.set('num_pages', '1');
  url.searchParams.set('country', p.country);
  url.searchParams.set('date_posted', p.datePosted);
  if (p.remote) url.searchParams.set('work_from_home', 'true');
  if (p.employmentTypes.length) url.searchParams.set('employment_types', p.employmentTypes.join(','));
  if (p.experience) url.searchParams.set('job_requirements', p.experience);
  return url.toString();
}

const safeUrl = (value) => {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function postedAt(raw) {
  if (raw.job_posted_at_datetime_utc) {
    const d = new Date(raw.job_posted_at_datetime_utc);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof raw.job_posted_at_timestamp === 'number') return new Date(raw.job_posted_at_timestamp * 1000).toISOString();
  return null;
}

// Converts a raw JSearch job into the shape the app uses. Unknown values stay
// null instead of being guessed.
export function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object' || !raw.job_id || !raw.job_title) return null;
  const location =
    clean(raw.job_location, 160) || [raw.job_city, raw.job_state, raw.job_country].map((v) => clean(v, 60)).filter(Boolean).join(', ');
  const min = num(raw.job_min_salary);
  const max = num(raw.job_max_salary);
  const types = Array.isArray(raw.job_employment_types) && raw.job_employment_types.length
    ? raw.job_employment_types
    : raw.job_employment_type
      ? String(raw.job_employment_type).split(/[,\s]+/)
      : [];
  const highlights = {};
  for (const [key, list] of Object.entries(raw.job_highlights || {})) {
    if (Array.isArray(list)) highlights[clean(key, 40)] = list.map((s) => clean(s, 400)).filter(Boolean).slice(0, 15);
  }
  const exp = raw.job_required_experience || {};
  return {
    id: clean(raw.job_id, 300),
    title: clean(raw.job_title, 200),
    employer: clean(raw.employer_name, 160) || 'Employer not listed',
    employerWebsite: safeUrl(raw.employer_website),
    publisher: clean(raw.job_publisher, 80),
    employmentTypes: [...new Set(types.map((t) => clean(t, 20).toUpperCase()).filter(Boolean))],
    isRemote: raw.job_is_remote === true,
    location,
    description: String(raw.job_description || '').slice(0, DESCRIPTION_MAX),
    applyLink:
      safeUrl(raw.job_apply_link) ||
      (Array.isArray(raw.apply_options) ? raw.apply_options.map((o) => safeUrl(o?.apply_link)).find(Boolean) : '') ||
      safeUrl(raw.job_google_link) ||
      '',
    applyIsDirect: raw.job_apply_is_direct === true,
    postedAt: postedAt(raw),
    postedLabel: clean(raw.job_posted_at, 40),
    expiresAt: raw.job_offer_expiration_datetime_utc ? clean(raw.job_offer_expiration_datetime_utc, 40) : null,
    salary:
      min || max
        ? { min, max, currency: clean(raw.job_salary_currency, 5) || null, period: clean(raw.job_salary_period, 10) || null }
        : clean(raw.job_salary_string || raw.job_salary, 60)
          ? { text: clean(raw.job_salary_string || raw.job_salary, 60) }
          : null,
    highlights,
    experience: {
      noExperienceRequired: exp.no_experience_required === true,
      months: num(exp.required_experience_in_months),
    },
  };
}

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

// In-memory usage counter (the database-backed one is passed in by server/api.js).
export function memoryUsageStore() {
  const counts = new Map();
  return {
    count: (period, service) => counts.get(`${period}:${service}`) || 0,
    increment: (period, service) => counts.set(`${period}:${service}`, (counts.get(`${period}:${service}`) || 0) + 1),
  };
}

// OpenWeb Ninja returns { data: { jobs, cursor } }; RapidAPI returns { data: [...] }.
export function readJSearchBody(body) {
  const data = body?.data;
  if (Array.isArray(data)) return { rawJobs: data, cursor: null };
  if (data && typeof data === 'object') {
    const cursor = typeof data.cursor === 'string' && CURSOR_RE.test(data.cursor) ? data.cursor : null;
    return { rawJobs: Array.isArray(data.jobs) ? data.jobs : [], cursor };
  }
  return { rawJobs: [], cursor: null };
}

const ERRORS = {
  notConfigured:
    'Job search is not set up yet. Add JSEARCH_API_KEY (your OpenWeb Ninja or RapidAPI key for JSearch) to the .env file and restart the app.',
  invalidKey: (provider) =>
    `JSearch (${PROVIDERS[provider].label}) rejected the API key. Check JSEARCH_API_KEY in your .env file — it should be ${PROVIDERS[provider].keyHelp} — and that your account is subscribed to a JSearch plan.`,
  rateLimited: (provider) =>
    `The JSearch request limit for your ${PROVIDERS[provider].label} plan has been reached. Wait a bit, or check your plan’s allowance.`,
  localLimit: 'This app has used its monthly job-search allowance (JSEARCH_MONTHLY_LIMIT). Searches will work again next month.',
  timeout: 'The job search service took too long to respond. Try again.',
  network: 'Could not reach the job search service. Check your internet connection and try again.',
  upstream: 'The job search service had a problem. Try again in a few minutes.',
};

export function createJobsHandler(env = {}, { usage = memoryUsageStore() } = {}) {
  const apiKey = (env.JSEARCH_API_KEY || env.RAPIDAPI_KEY || '').trim();
  const provider = resolveProvider(env);
  const host = (env.JSEARCH_API_HOST || 'jsearch.p.rapidapi.com').trim();
  const baseUrl = (env.JSEARCH_BASE_URL || (provider === 'rapidapi' ? `https://${host}` : PROVIDERS.openwebninja.baseUrl)).replace(/\/$/, '');
  const defaultCountry = COUNTRIES.includes((env.JSEARCH_COUNTRY || '').toLowerCase()) ? env.JSEARCH_COUNTRY.toLowerCase() : 'us';
  const monthlyLimit = Math.max(0, Number(env.JSEARCH_MONTHLY_LIMIT) || 0);
  const cache = new Map();
  let lastRemaining = null;

  function fromCache(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    return hit.value;
  }

  function toCache(key, value) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  async function search(p) {
    const key = JSON.stringify(p);
    const cached = fromCache(key);
    if (cached) return { ...cached, cached: true };

    if (monthlyLimit && (await usage.count(monthKey(), 'jsearch')) >= monthlyLimit) throw new HttpError(429, ERRORS.localLimit, 'local_limit');

    let response;
    try {
      await usage.increment(monthKey(), 'jsearch');
      response = await fetch(buildJSearchUrl(p, { provider, baseUrl }), {
        headers: { Accept: 'application/json', ...PROVIDERS[provider].headers(apiKey, host) },
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new HttpError(504, ERRORS.timeout, 'timeout');
      throw new HttpError(502, ERRORS.network, 'network');
    }
    const remaining = response.headers?.get?.('x-ratelimit-requests-remaining') ?? response.headers?.get?.('x-ratelimit-remaining');
    if (remaining !== null && remaining !== undefined && remaining !== '') lastRemaining = Number(remaining);

    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) throw new HttpError(502, ERRORS.invalidKey(provider), 'invalid_key');
    if (response.status === 429) throw new HttpError(429, ERRORS.rateLimited(provider), 'rate_limited');
    if (!response.ok || !body) throw new HttpError(502, ERRORS.upstream, 'upstream');
    if (body.status && body.status !== 'OK') throw new HttpError(502, ERRORS.upstream, 'upstream');

    const { rawJobs, cursor } = readJSearchBody(body);
    const seen = new Set();
    const jobs = rawJobs.map(normalizeJob).filter((j) => j && !seen.has(j.id) && seen.add(j.id));
    // OpenWeb Ninja says when there is a next page (cursor); RapidAPI doesn't, so a full page means "maybe more".
    const more = provider === 'openwebninja' ? Boolean(cursor) && rawJobs.length > 0 : rawJobs.length >= 10;
    const value = { jobs, page: p.page, hasMore: more && p.page < MAX_PAGE, cursor: more ? cursor : null, source: 'JSearch', cached: false };
    toCache(key, value);
    return value;
  }

  return async function jobsHandler(req, res, next) {
    const path = pathOf(req);
    if (req.method === 'GET' && path === '/status') {
      return send(res, 200, {
        configured: Boolean(apiKey),
        provider: apiKey ? PROVIDERS[provider].label : null,
        country: defaultCountry,
        monthlyLimit: monthlyLimit || null,
        usedThisMonth: await usage.count(monthKey(), 'jsearch'),
        providerRemaining: Number.isFinite(lastRemaining) ? lastRemaining : null,
      });
    }
    if (req.method === 'GET' && path === '/search') {
      try {
        if (!apiKey) throw new HttpError(503, ERRORS.notConfigured, 'not_configured');
        const params = parseSearchParams(queryOf(req), { defaultCountry });
        return send(res, 200, await search(params));
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
        console.error('[jobs] Unexpected error:', err);
        return send(res, 500, { error: ERRORS.upstream, code: 'server_error' });
      }
    }
    if (typeof next === 'function') return next();
    return send(res, 404, { error: 'Not found' });
  };
}
