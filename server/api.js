// Puts every /api route together. Used by vite.config.js (development and
// `npm run preview`) and by server/index.js (production).

import { createAiHandler } from './aiHandler.js';
import { createAuth } from './auth.js';
import { backupDatabase } from './backup.js';
import { createBilling } from './billing.js';
import { createDataHandler } from './dataHandler.js';
import { dbUsageStore, openDatabase } from './db.js';
import { createJobsHandler } from './jobsHandler.js';
import { createAiQuota, limitReachedMessage, planLimits } from './plans.js';
import { allowedOrigins, clientIp, createLimits, envFlag, isProduction, pathOf, peerIp, proxySettings, rateLimited, send } from './http.js';

// State-changing requests must be JSON and, when the browser says where they
// came from, come from this site. Together with SameSite cookies this blocks
// cross-site request forgery. appUrl: the public site (APP_URL). When the
// frontend is on another host (Vercel) that forwards /api here, the browser's
// Origin is that site, not this server's Host. extra: exact origins from
// ALLOWED_ORIGINS (see allowedOrigins in http.js).
export function sameOriginJson(req, appUrl = '', extra = []) {
  // Stripe webhooks come from Stripe's servers and are authenticated by their signature instead.
  if (req.method === 'POST' && pathOf(req) === '/billing/webhook') return true;
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  const type = String(req.headers?.['content-type'] || '');
  if (!type.toLowerCase().startsWith('application/json')) return false;
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const from = new URL(origin);
    return from.host === req.headers.host || (appUrl !== '' && from.origin === appUrl) || extra.includes(from.origin);
  } catch {
    return false;
  }
}

async function build(env, options) {
  const db = options.db || (await openDatabase(env.DATABASE_URL || 'data/pglite'));
  const trustProxy = proxySettings(env);
  // AI and job search use paid API keys, so on a public server only
  // signed-in users may call them (set API_REQUIRE_AUTH=false to allow guests).
  const requireAuthForApis = envFlag(env.API_REQUIRE_AUTH, isProduction(env));
  const log = options.log || console;
  // Deleting an account first cancels its subscription (billing is created after auth).
  let billing;
  const auth = createAuth({ db, env, log, beforeDeleteUser: (userId) => billing.cancelAllFor(userId) });
  billing = createBilling({ db, env, requireUser: auth.requireUser, stripe: options.stripe, log, now: options.now });
  const ai = createAiHandler(env);
  const jobs = createJobsHandler(env, { usage: dbUsageStore(db) });
  const data = createDataHandler({ db, requireUser: auth.requireUser });
  const limits = createLimits(db);
  const quota = createAiQuota(db, env, { planOf: billing.planOf, now: options.now });
  const isAiCall = (req) => req.method === 'POST';

  const paid = (name, rule, isCall) => async (req, user) => {
    if (!isCall(req)) return null;
    if (requireAuthForApis && !user) return [401, { error: 'Sign in to use this feature.', code: 'auth_required' }];
    const r = await limits.take(`${name}:${user ? `u:${user.id}` : `ip:${clientIp(req, trustProxy)}`}`, rule);
    return r.ok ? null : r;
  };

  return {
    db,
    requireAuthForApis,
    quota,
    billingConfigured: billing.config.configured,
    premiumLimit: planLimits(env).premium,
    // [prefix, handler, gate, counts against the monthly AI allowance]
    mounts: [
      ['/auth', auth.handler, null, null],
      ['/data', data, null, null],
      ['/billing', billing.handler, null, null],
      ['/ai', ai, paid('ai', { limit: 40, windowMs: 10 * 60 * 1000 }, isAiCall), isAiCall],
      ['/jobs', jobs, paid('jobs', { limit: 30, windowMs: 10 * 60 * 1000 }, (req) => pathOf(req) === '/search'), null],
    ],
    getUser: auth.getUser,
    settled: auth.settled,
  };
}

export function createApi(env = {}, options = {}) {
  let ready;
  let appOrigin = '';
  try {
    appOrigin = env.APP_URL ? new URL(String(env.APP_URL).trim()).origin : '';
  } catch {
    /* an invalid APP_URL is reported by checkConfig */
  }
  const extraOrigins = allowedOrigins(env).origins;
  // Each refused origin is logged once (capped), so a wrong APP_URL shows up in the server log.
  const refusedOrigins = new Set();

  // DEBUG_PROXY_HEADERS=true logs the forwarding headers of the next 20 requests, to check
  // which address headers the hosting proxies really set (docs/DEPLOY.md, "Check client IPs").
  let proxyLogsLeft = envFlag(env.DEBUG_PROXY_HEADERS, false) ? 20 : 0;

  // Connect-style middleware mounted at /api.
  async function api(req, res) {
    if (proxyLogsLeft > 0) {
      proxyLogsLeft -= 1;
      // Only these three address headers and the socket: never cookies, Authorization, the URL or the body.
      const h = (name) => JSON.stringify(String(req.headers?.[name] ?? '').slice(0, 200));
      const ip = (v) => (/^[0-9a-f:.]{2,45}$/i.test(String(v)) ? v : '"(not an IP address)"');
      const trust = proxySettings(env);
      (options.log || console).info?.(
        `[proxy] ${req.method} x-forwarded-for=${h('x-forwarded-for')} x-real-ip=${h('x-real-ip')} x-vercel-forwarded-for=${h('x-vercel-forwarded-for')} socket=${ip(req.socket?.remoteAddress)} -> visitor=${ip(clientIp(req, trust))} peer=${ip(peerIp(req, trust))}`,
      );
    }
    if (!sameOriginJson(req, appOrigin, extraOrigins)) {
      const origin = String(req.headers?.origin || '').slice(0, 200);
      if (origin && refusedOrigins.size < 50 && !refusedOrigins.has(origin)) {
        refusedOrigins.add(origin);
        (options.log || console).warn?.(`[api] Refused a ${req.method} request from ${origin}: it is neither APP_URL (${appOrigin || 'not set'}), ALLOWED_ORIGINS nor this server. If ${origin} is your production site, set APP_URL to it; to trust this one extra address, add it to ALLOWED_ORIGINS.`);
      }
      // A real visitor on another copy of the site (e.g. a Vercel deployment URL) is told where the app lives.
      const where = appOrigin && origin ? ` Open ${appOrigin} and try again.` : '';
      return send(res, 403, { error: `This request was blocked for security reasons.${where}`, code: 'forbidden' });
    }
    let app;
    try {
      ready ??= build(env, options);
      app = await ready;
    } catch (err) {
      ready = undefined;
      (options.log || console).error?.('[api] Could not open the database:', err);
      return send(res, 500, { error: 'The server could not open its database. Check DATABASE_URL and the server logs.', code: 'db_unavailable' });
    }
    const full = pathOf(req);
    if (full === '/config' && req.method === 'GET') {
      return send(res, 200, { requireAuthForApis: app.requireAuthForApis });
    }
    // Plan and AI allowance of the signed-in user.
    if (full === '/usage' && req.method === 'GET') {
      const user = await app.getUser(req);
      return send(res, 200, user ? { signedIn: true, ai: await app.quota.usage(user.id) } : { signedIn: false, ai: null });
    }
    for (const [prefix, handler, gate, metered] of app.mounts) {
      if (full !== prefix && !full.startsWith(`${prefix}/`)) continue;
      const originalUrl = req.url;
      req.url = req.url.slice(prefix.length) || '/';
      let reservation = null;
      let user = null;
      let succeeded = false;
      try {
        if (gate) {
          user = await app.getUser(req);
          const blocked = await gate(req, user);
          if (Array.isArray(blocked)) return send(res, ...blocked);
          if (blocked) return rateLimited(res, blocked.retryAfter);
        }
        // Guests (only allowed when API_REQUIRE_AUTH is off) are limited by the rate limiter alone.
        if (metered?.(req) && user) {
          reservation = await app.quota.reserve(user.id);
          if (!reservation.ok) {
            const { usage, busy, retryAfter } = reservation;
            reservation = null;
            if (busy === 'new') return rateLimited(res, retryAfter, 'AI for new accounts is very busy today, so it’s paused until midnight UTC. Your monthly allowance is untouched, and the Basic-mode tools still work.');
            if (busy) return rateLimited(res, retryAfter, 'Free AI requests are paused for the rest of today because of very high demand. They come back at midnight UTC, and the Basic-mode tools still work.');
            const upgrade = { upgrade: app.billingConfigured, premiumLimit: app.premiumLimit };
            return send(res, 403, { error: limitReachedMessage(usage, upgrade), code: 'ai_limit_reached', usage });
          }
        }
        const result = await handler(req, res, () => send(res, 404, { error: 'Not found' }));
        succeeded = res.statusCode === 200;
        return result;
      } finally {
        if (reservation && !succeeded) await app.quota.refund(user.id, reservation);
        req.url = originalUrl;
      }
    }
    return send(res, 404, { error: 'Not found' });
  }

  api.ready = () => (ready ??= build(env, options));
  // Resolves once emails queued so far were handed to the email service (tests).
  api.settled = async () => (await api.ready()).settled();
  // For health checks: throws if the database can't be read.
  api.health = async () => {
    const app = await api.ready();
    await app.db.one('SELECT 1');
  };
  // Writes a snapshot of the database to a file (see server/backup.js).
  api.backup = async (settings) => backupDatabase((await api.ready()).db, settings);
  // Closes the database cleanly (on shutdown).
  api.close = async () => {
    if (ready) await (await ready).db.close();
  };
  return api;
}
