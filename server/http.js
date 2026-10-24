// Small HTTP helpers shared by every server route. Plain Node, no framework,
// so the same handlers run inside Vite (development) and server/index.js
// (production).

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function readJson(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > limit) {
        tooLarge = true;
        reject(new HttpError(413, 'This request is too large.', 'too_large'));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, 'The request was not valid JSON.', 'invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function pathOf(req) {
  return (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
}

export function queryOf(req) {
  const i = (req.url || '').indexOf('?');
  return new URLSearchParams(i === -1 ? '' : req.url.slice(i + 1));
}

export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Fixed-window rate limiter kept in memory. Good enough for a single server
// process; use a shared store (e.g. Redis) if you run several instances.
export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  // Returns { ok, retryAfter } and counts the attempt.
  take(key, now = Date.now()) {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      if (this.hits.size > 10000) this.prune(now);
      return { ok: true, retryAfter: 0 };
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      return { ok: false, retryAfter: Math.ceil((entry.start + this.windowMs - now) / 1000) };
    }
    return { ok: true, retryAfter: 0 };
  }

  prune(now = Date.now()) {
    for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
  }
}

export function rateLimited(res, retryAfter, message = 'Too many requests. Please wait a moment and try again.') {
  return send(res, 429, { error: message, code: 'rate_limited', retryAfter }, { 'Retry-After': String(retryAfter || 60) });
}

export function isProduction(env = {}) {
  return (env.NODE_ENV || process.env.NODE_ENV) === 'production';
}

export function envFlag(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}
