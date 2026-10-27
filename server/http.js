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

// Reads the body exactly as sent, as a Buffer. Needed where a signature is
// computed over the original bytes (Stripe webhooks).
export function readRaw(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > limit) {
        tooLarge = true;
        reject(new HttpError(413, 'This request is too large.', 'too_large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
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

// How to find the visitor's address behind a proxy:
//   CLIENT_IP_HEADER  a header the proxy sets and visitors can't forge, e.g.
//                     cf-connecting-ip (Cloudflare, used by Render).
//   TRUST_PROXY=true  otherwise use the first X-Forwarded-For entry.
export function proxySettings(env = {}) {
  const header = String(env.CLIENT_IP_HEADER || '').trim().toLowerCase();
  // Never a header that carries credentials: it would become a rate-limit key (stored) and be logged.
  const ok = /^[a-z0-9-]{1,64}$/.test(header) && !/cookie|auth|token|key|secret|signature/.test(header);
  return { trust: envFlag(env.TRUST_PROXY, false), header: ok ? header : '' };
}

// proxy: true/false (TRUST_PROXY) or the result of proxySettings().
export function clientIp(req, proxy = false) {
  const { trust: trustProxy, header } = typeof proxy === 'object' ? proxy : { trust: proxy, header: '' };
  const fromHeader = header ? String(req.headers?.[header] || '').split(',')[0].trim() : '';
  if (fromHeader) return fromHeader;
  if (trustProxy) {
    const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'unknown';
}

// The address that connected to the host's proxy: the LAST X-Forwarded-For
// entry, which that proxy writes itself. Unlike the first entry (or any header a
// visitor sends straight to the Railway address), visitors can't choose it.
// Through Vercel it is Vercel's address, shared by many visitors.
export function peerIp(req, proxy = false) {
  const trust = typeof proxy === 'object' ? proxy.trust : proxy;
  const last = trust ? String(req.headers?.['x-forwarded-for'] || '').split(',').pop().trim() : '';
  return last || req.socket?.remoteAddress || 'unknown';
}

// Loopback and private-network addresses (the host's own internal hops).
export const isPrivateIp = (ip) =>
  ip === 'unknown' || /^(::ffff:)?(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|^(::1$|f[cd]|fe80:)/i.test(ip);

// Fixed-window rate limits stored in the database (table rate_limits), so they
// survive restarts and are shared by every server instance. Each check is one
// atomic statement: parallel requests can't slip past a limit.
//   rule: { limit, windowMs }
export function createLimits(db) {
  let lastPurge = 0;
  // Keys this process just saw over their limit, until when (ms). During a flood, repeat
  // requests are refused here without touching the database (no hot-row writes, no pool
  // exhaustion). Kept for at most BLOCK_CACHE_MS, so a clear() on another instance applies soon.
  const blocked = new Map();
  const BLOCK_CACHE_MS = 5000;
  return {
    // Counts one attempt for key. Returns { ok, retryAfter } (seconds).
    async take(key, { limit, windowMs }, now = Date.now()) {
      const known = blocked.get(key);
      if (known && known.until > now) return { ok: false, retryAfter: Math.max(1, Math.ceil((known.end - now) / 1000)) };
      if (known) blocked.delete(key);
      const row = await db.one(
        `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start <= $3 THEN 1 ELSE rate_limits.count + 1 END,
           window_start = CASE WHEN rate_limits.window_start <= $3 THEN $2 ELSE rate_limits.window_start END
         RETURNING count, window_start`,
        [key, now, now - windowMs],
      );
      if (now - lastPurge > 3600000) {
        lastPurge = now;
        // Rows older than the longest window (24 h). Off the request path: a failure here must not fail the request.
        db.run('DELETE FROM rate_limits WHERE window_start < $1', [now - 86400000]).catch((err) => console.error('[limits] Cleanup failed:', err.message));
      }
      if (row.count <= limit) return { ok: true, retryAfter: 0 };
      const end = Number(row.window_start) + windowMs;
      if (blocked.size >= 10000) blocked.clear();
      blocked.set(key, { until: Math.min(end, now + BLOCK_CACHE_MS), end });
      return { ok: false, retryAfter: Math.max(1, Math.ceil((end - now) / 1000)) };
    },
    // Gives back one attempt (e.g. a sign-in that turned out to be correct).
    untake: (key) => db.run('UPDATE rate_limits SET count = count - 1 WHERE key = $1 AND count > 0', [key]),
    clear: (key) => {
      blocked.delete(key);
      return db.run('DELETE FROM rate_limits WHERE key = $1', [key]);
    },
  };
}

export function rateLimited(res, retryAfter, message = 'Too many requests. Please wait a moment and try again.') {
  return send(res, 429, { error: message, code: 'rate_limited', retryAfter }, { 'Retry-After': String(retryAfter || 60) });
}

export function isProduction(env = {}) {
  return (env.NODE_ENV || process.env.NODE_ENV) === 'production';
}

// In production the host's proxy terminates HTTPS and tells us the original
// scheme in X-Forwarded-Proto. Requests that came in over plain http are sent
// to the same path on APP_URL (never to the Host header, which anyone can set).
// Returns the address to redirect to, or null.
export function httpsRedirect(req, env = {}) {
  if (!isProduction(env) || String(env.COOKIE_SECURE).trim() === 'false') return null;
  const appUrl = String(env.APP_URL || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(appUrl)) return null;
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto !== 'http') return null;
  const path = String(req.url || '/');
  return appUrl + (path.startsWith('/') ? path : '/');
}

// ALLOWED_ORIGINS: sites trusted to send requests besides APP_URL (e.g. a
// Vercel branch preview), as exact https:// origins separated by commas.
// Wildcards, paths and http:// are refused, so previews are never trusted by accident.
export function allowedOrigins(env = {}) {
  const origins = [];
  const invalid = [];
  for (const raw of String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    let url = null;
    try {
      url = new URL(raw);
    } catch {
      /* reported as invalid */
    }
    if (url && url.protocol === 'https:' && !raw.includes('*') && url.origin === raw.replace(/\/$/, '')) origins.push(url.origin);
    else invalid.push(raw.slice(0, 100));
  }
  return { origins, invalid };
}

export function envFlag(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}
