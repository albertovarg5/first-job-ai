// Accounts: sign up, sign in, sign out, password reset, change password and
// account deletion.
//
// - Passwords are hashed with scrypt (random salt per user) and compared in
//   constant time. Plain passwords are never stored or logged.
// - Sessions are random 256-bit tokens kept in an HttpOnly, SameSite=Lax
//   cookie. Only a SHA-256 hash of the token is stored in the database.
// - Sign-in, sign-up and reset requests are rate limited per IP and email.
//
// Routes (mounted at /api/auth):
//   GET  /me               POST /signup        POST /signin
//   POST /signout          POST /forgot        POST /reset
//   POST /change-password  POST /delete-account

import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  HttpError,
  RateLimiter,
  clientIp,
  envFlag,
  isProduction,
  parseCookies,
  pathOf,
  rateLimited,
  readJson,
  send,
  serializeCookie,
} from './http.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'fja_session';
const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export function validateEmail(email) {
  const e = String(email || '').trim();
  if (!e) return 'Enter your email address.';
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(password, email = '') {
  const p = String(password || '');
  if (p.length < 8) return 'Use at least 8 characters for your password.';
  if (p.length > 200) return 'Use 200 characters or fewer for your password.';
  if (email && p.toLowerCase() === String(email).trim().toLowerCase()) return 'Your password can’t be the same as your email.';
  if (/^(.)\1+$/.test(p) || ['password', 'password1', '12345678', '123456789', 'qwertyui', 'firstjob'].includes(p.toLowerCase())) {
    return 'That password is too easy to guess. Try a short phrase instead.';
  }
  return null;
}

async function sendResetEmail(env, to, link) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: 'Reset your First Job AI password',
      text: `Someone asked to reset the password for your First Job AI account.\n\nTo choose a new password, open this link within ${RESET_MINUTES} minutes:\n${link}\n\nIf you didn't ask for this, you can ignore this email. Your password won't change.`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Email provider returned status ${res.status}`);
}

export function createAuth({ db, env = {}, log = console }) {
  const production = isProduction(env);
  const secureCookie = envFlag(env.COOKIE_SECURE, production);
  const trustProxy = envFlag(env.TRUST_PROXY, false);
  const emailConfigured = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  const appUrl = (env.APP_URL || '').replace(/\/$/, '');
  // In development without email, reset links are printed to the server terminal.
  const devResetLinks = !production && !emailConfigured;

  const ipLimiter = new RateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 });
  const emailLimiter = new RateLimiter({ limit: 6, windowMs: 15 * 60 * 1000 });
  const signupLimiter = new RateLimiter({ limit: 8, windowMs: 60 * 60 * 1000 });
  const resetLimiter = new RateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, password_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)'),
    setPassword: db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare(
      'SELECT users.id, users.email, users.created_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    insertReset: db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    resetByToken: db.prepare('SELECT * FROM password_resets WHERE token_hash = ?'),
    useReset: db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?'),
    deleteUserResets: db.prepare('DELETE FROM password_resets WHERE user_id = ?'),
  };

  // A fixed hash so a sign-in for an unknown email takes as long as a real one.
  const dummyHash = hashPassword(randomBytes(12).toString('hex'));

  const publicUser = (u) => ({ id: u.id, email: u.email, createdAt: u.created_at });

  function startSession(res, userId) {
    const token = newToken();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
    q.insertSession.run(sha256(token), userId, now.toISOString(), expires.toISOString());
    if (Math.random() < 0.05) q.purgeSessions.run(now.toISOString());
    res.setHeader('Set-Cookie', serializeCookie(COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: secureCookie }));
    return token;
  }

  function clearCookie(res) {
    res.setHeader('Set-Cookie', serializeCookie(COOKIE, '', { maxAge: 0, secure: secureCookie }));
  }

  function sessionToken(req) {
    return parseCookies(req)[COOKIE] || '';
  }

  // Returns the signed-in user for a request, or null.
  function getUser(req) {
    const token = sessionToken(req);
    if (!token || token.length > 100) return null;
    const row = q.sessionUser.get(sha256(token), new Date().toISOString());
    return row ? publicUser(row) : null;
  }

  function requireUser(req) {
    const user = getUser(req);
    if (!user) throw new HttpError(401, 'Please sign in again.', 'auth_required');
    return user;
  }

  function limit(limiter, key) {
    const r = limiter.take(key);
    if (!r.ok) throw Object.assign(new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.', 'rate_limited'), { retryAfter: r.retryAfter });
  }

  function resetLinkBase(req) {
    if (appUrl) return appUrl;
    if (production) return null;
    const origin = req.headers?.origin;
    return origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : 'http://localhost:5173';
  }

  const routes = {
    'GET /me': async (req, res) => send(res, 200, { user: getUser(req), passwordReset: emailConfigured ? 'email' : devResetLinks ? 'console' : 'unavailable' }),

    'POST /signup': async (req, res) => {
      limit(signupLimiter, clientIp(req, trustProxy));
      const body = await readJson(req, 10000);
      const email = String(body.email || '').trim().toLowerCase();
      const emailError = validateEmail(email);
      if (emailError) throw new HttpError(400, emailError, 'invalid_email');
      const passwordError = validatePassword(body.password, email);
      if (passwordError) throw new HttpError(400, passwordError, 'weak_password');
      if (q.userByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.', 'email_taken');
      const now = new Date().toISOString();
      const id = randomUUID();
      q.insertUser.run(id, email, await hashPassword(String(body.password)), now, now);
      startSession(res, id);
      return send(res, 201, { user: publicUser(q.userById.get(id)) });
    },

    'POST /signin': async (req, res) => {
      limit(ipLimiter, clientIp(req, trustProxy));
      const body = await readJson(req, 10000);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (validateEmail(email) || !password) throw new HttpError(400, 'Enter your email and password.', 'invalid_input');
      limit(emailLimiter, email);
      const user = q.userByEmail.get(email);
      const ok = await verifyPassword(password.slice(0, 200), user ? user.password_hash : await dummyHash);
      if (!user || !ok) throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');
      startSession(res, user.id);
      return send(res, 200, { user: publicUser(user) });
    },

    'POST /signout': async (req, res) => {
      const token = sessionToken(req);
      if (token) q.deleteSession.run(sha256(token));
      clearCookie(res);
      return send(res, 200, { ok: true });
    },

    'POST /forgot': async (req, res) => {
      limit(resetLimiter, clientIp(req, trustProxy));
      const body = await readJson(req, 10000);
      const email = String(body.email || '').trim().toLowerCase();
      if (validateEmail(email)) throw new HttpError(400, 'Enter a valid email address.', 'invalid_email');
      const base = resetLinkBase(req);
      if (!emailConfigured && !devResetLinks) {
        throw new HttpError(501, 'Password reset by email isn’t set up on this server yet. Contact the site owner.', 'reset_unavailable');
      }
      if (!base) throw new HttpError(501, 'Password reset needs APP_URL to be set on the server.', 'reset_unavailable');
      limit(emailLimiter, `reset:${email}`);
      const user = q.userByEmail.get(email);
      if (user) {
        const token = newToken();
        q.insertReset.run(sha256(token), user.id, new Date(Date.now() + RESET_MINUTES * 60000).toISOString());
        const link = `${base}/reset-password?token=${token}`;
        if (emailConfigured) {
          try {
            await sendResetEmail(env, user.email, link);
          } catch (err) {
            log.error?.(`[auth] Could not send the reset email: ${err.message}`);
            throw new HttpError(502, 'We couldn’t send the email right now. Please try again later.', 'email_failed');
          }
        } else {
          log.info?.(`\n[First Job AI] Password reset link for ${user.email} (development only, valid ${RESET_MINUTES} min):\n${link}\n`);
        }
      }
      // Same answer whether or not the account exists.
      return send(res, 200, {
        ok: true,
        message: devResetLinks
          ? 'If an account exists for that email, a reset link was printed in the terminal where the app is running (email is not set up in development).'
          : 'If an account exists for that email, we sent a link to reset your password. Check your inbox and spam folder.',
      });
    },

    'POST /reset': async (req, res) => {
      limit(ipLimiter, clientIp(req, trustProxy));
      const body = await readJson(req, 10000);
      const token = String(body.token || '');
      const row = token && token.length < 100 ? q.resetByToken.get(sha256(token)) : null;
      if (!row || row.used_at || row.expires_at <= new Date().toISOString()) {
        throw new HttpError(400, 'This reset link is invalid or has expired. Ask for a new one.', 'invalid_token');
      }
      const user = q.userById.get(row.user_id);
      const passwordError = validatePassword(body.password, user?.email);
      if (passwordError) throw new HttpError(400, passwordError, 'weak_password');
      const now = new Date().toISOString();
      q.setPassword.run(await hashPassword(String(body.password)), now, user.id);
      q.useReset.run(now, row.token_hash);
      q.deleteUserResets.run(user.id);
      q.deleteUserSessions.run(user.id); // Sign out everywhere else.
      startSession(res, user.id);
      return send(res, 200, { user: publicUser(user) });
    },

    'POST /change-password': async (req, res) => {
      const user = requireUser(req);
      limit(emailLimiter, `change:${user.id}`);
      const body = await readJson(req, 10000);
      const row = q.userById.get(user.id);
      if (!(await verifyPassword(String(body.currentPassword || '').slice(0, 200), row.password_hash))) {
        throw new HttpError(400, 'Your current password is incorrect.', 'invalid_credentials');
      }
      const passwordError = validatePassword(body.newPassword, row.email);
      if (passwordError) throw new HttpError(400, passwordError, 'weak_password');
      q.setPassword.run(await hashPassword(String(body.newPassword)), new Date().toISOString(), user.id);
      q.deleteOtherSessions.run(user.id, sha256(sessionToken(req)));
      return send(res, 200, { ok: true });
    },

    'POST /delete-account': async (req, res) => {
      const user = requireUser(req);
      limit(emailLimiter, `delete:${user.id}`);
      const body = await readJson(req, 10000);
      const row = q.userById.get(user.id);
      if (!(await verifyPassword(String(body.password || '').slice(0, 200), row.password_hash))) {
        throw new HttpError(400, 'Your password is incorrect.', 'invalid_credentials');
      }
      q.deleteUser.run(user.id); // Sessions, resets and saved data are deleted with it.
      clearCookie(res);
      return send(res, 200, { ok: true });
    },
  };

  async function handler(req, res, next) {
    const route = routes[`${req.method} ${pathOf(req)}`];
    if (!route) return typeof next === 'function' ? next() : send(res, 404, { error: 'Not found' });
    try {
      return await route(req, res);
    } catch (err) {
      if (err.code === 'rate_limited') return rateLimited(res, err.retryAfter, err.message);
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      log.error?.(err);
      return send(res, 500, { error: 'Something went wrong on the server. Please try again.', code: 'server_error' });
    }
  }

  return { handler, getUser, requireUser };
}
