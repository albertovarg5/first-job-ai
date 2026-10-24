// Puts every /api route together. Used by vite.config.js (development and
// `npm run preview`) and by server/index.js (production).

import { createAiHandler } from './aiHandler.js';
import { createJobsHandler } from './jobsHandler.js';
import { RateLimiter, clientIp, envFlag, pathOf, rateLimited, send } from './http.js';

// State-changing requests must be JSON and, when the browser says where they
// came from, come from this site. Together with SameSite cookies this blocks
// cross-site request forgery.
export function sameOriginJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  const type = String(req.headers?.['content-type'] || '');
  if (!type.toLowerCase().startsWith('application/json')) return false;
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createApi(env = {}) {
  const trustProxy = envFlag(env.TRUST_PROXY, false);
  const ai = createAiHandler(env);
  const jobs = createJobsHandler(env);
  const aiLimiter = new RateLimiter({ limit: 40, windowMs: 10 * 60 * 1000 });
  const jobsLimiter = new RateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

  const mounts = [
    ['/ai', ai, aiLimiter, (req) => req.method === 'POST'],
    ['/jobs', jobs, jobsLimiter, (req) => pathOf(req) === '/search'],
  ];

  // Connect-style middleware mounted at /api.
  return async function api(req, res, next) {
    if (!sameOriginJson(req)) {
      return send(res, 403, { error: 'This request was blocked for security reasons.', code: 'forbidden' });
    }
    const full = pathOf(req);
    for (const [prefix, handler, limiter, limited] of mounts) {
      if (full !== prefix && !full.startsWith(`${prefix}/`)) continue;
      const originalUrl = req.url;
      req.url = req.url.slice(prefix.length) || '/';
      try {
        if (limited(req)) {
          const r = limiter.take(clientIp(req, trustProxy));
          if (!r.ok) return rateLimited(res, r.retryAfter);
        }
        return await handler(req, res, () => send(res, 404, { error: 'Not found' }));
      } finally {
        req.url = originalUrl;
      }
    }
    return send(res, 404, { error: 'Not found' });
  };
}
