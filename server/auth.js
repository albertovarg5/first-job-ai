// Accounts: sign up, sign in, sign out, password reset, change password and
// account deletion.
//
// - Passwords are hashed with scrypt (random salt per user) and compared in
//   constant time. Plain passwords are never stored or logged.
// - Sessions are random 256-bit tokens kept in an HttpOnly, SameSite=Lax
//   cookie. Only a SHA-256 hash of the token is stored in the database. A
//   session ends after SESSION_IDLE_DAYS without use, and SESSION_DAYS at most.
// - Rate limits live in the database (see createLimits in http.js).
// - Failed sign-ins are counted per account. A browser that signed in to that
//   account before ("trusted device" cookie) has its own count, so a stranger
//   guessing passwords can't lock the owner out; a password reset unlocks too.
// - With email verification on (EMAIL_VERIFICATION, default on in production),
//   the account is only created when the link in the email is opened and the
//   password is entered again. Sign-up, sign-in and reset answer the same way
//   whether or not an account exists, and emails are sent in the background
//   so the response time doesn't tell either.
//
// Routes (mounted at /api/auth):
//   GET  /me               POST /signup        POST /verify      POST /signin
//   POST /signout          POST /forgot        POST /reset
//   POST /change-password  POST /delete-account

import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  HttpError,
  clientIp,
  createLimits,
  isPrivateIp,
  peerIp,
  proxySettings,
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
const DEVICE_COOKIE = 'fja_device';
const SESSION_DAYS = 30;
export const SESSION_IDLE_DAYS = 7;
const DEVICE_DAYS = 180;
const MAX_DEVICES = 10;
const RESET_MINUTES = 60;
const VERIFY_HOURS = 24;
const MIN = 60000;
const HOUR = 60 * MIN;
// { limit, windowMs } for createLimits().
const LIMITS = {
  signinIp: { limit: 20, windowMs: 15 * MIN },
  signupIp: { limit: 8, windowMs: HOUR },
  forgotIp: { limit: 5, windowMs: HOUR },
  // Wrong passwords per account from unknown browsers, and per trusted browser.
  loginFailures: { limit: 6, windowMs: 15 * MIN },
  // Emails to one address, and in total (protects the sender's reputation and the Resend quota).
  mailPerAddress: { limit: 3, windowMs: HOUR },
  mailTotal: { limit: 100, windowMs: HOUR },
  verifyAttempts: { limit: 5, windowMs: VERIFY_HOURS * HOUR },
  account: { limit: 6, windowMs: 15 * MIN },
};
// The same limits x10 on the address that reached the host's proxy (peerIp): see limitIp.
const PEER_FACTOR = 10;
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

// Stores a new single-use reset token for a user and returns it. Only its hash
// is kept; it expires after RESET_MINUTES. Also used by `npm run reset-link`.
export async function createResetToken(db, userId) {
  const token = newToken();
  await db.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token),
    userId,
    new Date(Date.now() + RESET_MINUTES * 60000).toISOString(),
  ]);
  return token;
}

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

const resetEmail = (link) => ({
  subject: 'Reset your First Job AI password',
  text: `Someone asked to reset the password for your First Job AI account.\n\nTo choose a new password, open this link within ${RESET_MINUTES} minutes:\n${link}\n\nIf you didn't ask for this, you can ignore this email. Your password won't change.`,
});
const verifyEmail = (link) => ({
  subject: 'Confirm your email to finish creating your First Job AI account',
  text: `Welcome to First Job AI!\n\nTo finish creating your account, open this link within ${VERIFY_HOURS} hours and enter the password you chose:\n${link}\n\nIf you didn't sign up, you can ignore this email. No account is created without the password.`,
});
const existingAccountEmail = (base) => ({
  subject: 'You already have a First Job AI account',
  text: `Someone (probably you) tried to create a First Job AI account with this email, but you already have one.\n\nSign in: ${base}/signin\nForgot your password? ${base}/forgot-password\n\nIf this wasn't you, you can ignore this email. Nothing was changed.`,
});

async function sendEmail(env, to, { subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    // Resend explains problems such as an unverified sender domain in the body.
    // Its messages can name an address (e.g. the account owner's), so addresses are masked for the log.
    const detail = await res.json().then((b) => [b?.name, b?.message].filter(Boolean).join(': '), () => '');
    throw new Error(`Resend returned status ${res.status}${detail ? `: ${detail.replace(/[^\s@()<>]+@[^\s@()<>]+/g, '<address>')}` : ''}`);
  }
  // Resend's id for this email: search for it under Emails in the Resend dashboard.
  return (await res.json().catch(() => null))?.id || 'unknown';
}

// beforeDeleteUser(userId) runs before an account is deleted and may throw to stop it
// (used to cancel a paid subscription first).
export function createAuth({ db, env = {}, log = console, beforeDeleteUser }) {
  const production = isProduction(env);
  const secureCookie = envFlag(env.COOKIE_SECURE, production);
  const trustProxy = proxySettings(env);
  const emailConfigured = Boolean(String(env.RESEND_API_KEY || '').trim() && String(env.EMAIL_FROM || '').trim());
  const appUrl = (env.APP_URL || '').replace(/\/$/, '');
  // In development without email, reset and confirmation links are printed to the server terminal.
  const devResetLinks = !production && !emailConfigured;
  const verifyEmails = envFlag(env.EMAIL_VERIFICATION, production);
  const limits = createLimits(db);

  const q = {
    userByEmail: (email) => db.one('SELECT * FROM users WHERE email = $1', [email]),
    userById: (id) => db.one('SELECT * FROM users WHERE id = $1', [id]),
    insertUser: (...p) => db.run('INSERT INTO users (id, email, password_hash, created_at, password_changed_at) VALUES ($1, $2, $3, $4, $5)', p),
    setPassword: (...p) => db.run('UPDATE users SET password_hash = $1, password_changed_at = $2 WHERE id = $3', p),
    deleteUser: (id) => db.run('DELETE FROM users WHERE id = $1', [id]),
    insertSession: (...p) => db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $3)', p),
    sessionUser: (...p) =>
      db.one(
        `SELECT users.id, users.email, users.created_at, sessions.last_seen_at FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = $1 AND sessions.expires_at > $2 AND COALESCE(sessions.last_seen_at, sessions.created_at) > $3`,
        p,
      ),
    touchSession: (...p) => db.run('UPDATE sessions SET last_seen_at = $1 WHERE token_hash = $2', p),
    deleteSession: (hash) => db.run('DELETE FROM sessions WHERE token_hash = $1', [hash]),
    deleteUserSessions: (id) => db.run('DELETE FROM sessions WHERE user_id = $1', [id]),
    deleteOtherSessions: (...p) => db.run('DELETE FROM sessions WHERE user_id = $1 AND token_hash != $2', p),
    purgeSessions: (...p) => db.run('DELETE FROM sessions WHERE expires_at <= $1 OR COALESCE(last_seen_at, created_at) <= $2', p),
    resetByToken: (hash) => db.one('SELECT * FROM password_resets WHERE token_hash = $1', [hash]),
    useReset: (...p) => db.run('UPDATE password_resets SET used_at = $1 WHERE token_hash = $2 AND used_at IS NULL', p),
    deleteUserResets: (id) => db.run('DELETE FROM password_resets WHERE user_id = $1', [id]),
    deviceUser: (...p) => db.one('SELECT user_id FROM trusted_devices WHERE token_hash = $1 AND expires_at > $2', p),
    insertDevice: (...p) => db.run('INSERT INTO trusted_devices (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', p),
    deleteUserDevices: (id) => db.run('DELETE FROM trusted_devices WHERE user_id = $1', [id]),
    // Keeps the newest MAX_DEVICES per user, so repeated sign-ins without the cookie can't grow the table.
    trimDevices: (id) =>
      db.run(
        'DELETE FROM trusted_devices WHERE user_id = $1 AND token_hash NOT IN (SELECT token_hash FROM trusted_devices WHERE user_id = $1 ORDER BY expires_at DESC LIMIT $2)',
        [id, MAX_DEVICES],
      ),
    purgeExpired: (now) =>
      Promise.all([db.run('DELETE FROM trusted_devices WHERE expires_at <= $1', [now]), db.run('DELETE FROM email_verifications WHERE expires_at <= $1', [now])]),
    insertVerification: (...p) => db.run('INSERT INTO email_verifications (token_hash, email, password_hash, expires_at) VALUES ($1, $2, $3, $4)', p),
    verificationByToken: (hash) => db.one('SELECT * FROM email_verifications WHERE token_hash = $1', [hash]),
    deleteVerifications: (email) => db.run('DELETE FROM email_verifications WHERE email = $1', [email]),
  };

  // A fixed hash so a sign-in for an unknown email takes as long as a real one.
  const dummyHash = hashPassword(randomBytes(12).toString('hex'));

  const publicUser = (u) => ({ id: u.id, email: u.email, createdAt: u.created_at });

  // Adds a Set-Cookie header without replacing one set earlier in the same response.
  function addCookie(res, cookie) {
    const prev = res.getHeader?.('Set-Cookie');
    res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
  }

  async function startSession(req, res, userId) {
    // Rotation: the session this browser had before is ended, never reused.
    const old = sessionToken(req);
    if (old && old.length <= 100) await q.deleteSession(sha256(old));
    const token = newToken();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
    await q.insertSession(sha256(token), userId, now.toISOString(), expires.toISOString());
    if (Math.random() < 0.05) {
      await q.purgeSessions(now.toISOString(), new Date(now.getTime() - SESSION_IDLE_DAYS * 86400000).toISOString());
      await q.purgeExpired(now.toISOString());
    }
    addCookie(res, serializeCookie(COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: secureCookie }));
    return token;
  }

  function clearCookie(res) {
    res.setHeader('Set-Cookie', serializeCookie(COOKIE, '', { maxAge: 0, secure: secureCookie }));
  }

  function sessionToken(req) {
    return parseCookies(req)[COOKIE] || '';
  }

  // The hash of this browser's trusted-device token if it belongs to userId, else null.
  async function trustedDevice(req, userId) {
    const token = parseCookies(req)[DEVICE_COOKIE] || '';
    if (!token || token.length > 100 || !userId) return null;
    const row = await q.deviceUser(sha256(token), new Date().toISOString());
    return row?.user_id === userId ? sha256(token) : null;
  }

  // After a successful sign-in: remember this browser for this account.
  async function trustDevice(req, res, userId) {
    if (await trustedDevice(req, userId)) return;
    const token = newToken();
    await q.insertDevice(sha256(token), userId, new Date(Date.now() + DEVICE_DAYS * 86400000).toISOString());
    await q.trimDevices(userId);
    addCookie(res, serializeCookie(DEVICE_COOKIE, token, { maxAge: DEVICE_DAYS * 86400, secure: secureCookie }));
  }

  // Returns the signed-in user for a request, or null. Sessions unused for
  // SESSION_IDLE_DAYS end; use is recorded at most once an hour.
  async function getUser(req) {
    const token = sessionToken(req);
    if (!token || token.length > 100) return null;
    const now = Date.now();
    const row = await q.sessionUser(sha256(token), new Date(now).toISOString(), new Date(now - SESSION_IDLE_DAYS * 86400000).toISOString());
    if (!row) return null;
    if (!row.last_seen_at || Date.parse(row.last_seen_at) < now - HOUR) await q.touchSession(new Date(now).toISOString(), sha256(token));
    return publicUser(row);
  }

  async function requireUser(req) {
    const user = await getUser(req);
    if (!user) throw new HttpError(401, 'Please sign in again.', 'auth_required');
    return user;
  }

  const tooMany = (retryAfter, message = 'Too many attempts. Please wait a few minutes and try again.') =>
    Object.assign(new HttpError(429, message, 'rate_limited'), { retryAfter });

  async function limit(rule, key, message) {
    const r = await limits.take(key, rule);
    if (!r.ok) throw tooMany(r.retryAfter, message);
  }

  // Per visitor address, and x PEER_FACTOR per address that reached the host's
  // proxy. The visitor address can be forged by calling the server directly; the
  // peer can't, but everyone arriving through Vercel may share it (hence the factor).
  async function limitIp(name, req) {
    const rule = LIMITS[name];
    // The unforgeable peer first: once it is blocked, made-up visitor addresses add no rows.
    const peer = peerIp(req, trustProxy);
    if (!isPrivateIp(peer)) await limit({ ...rule, limit: rule.limit * PEER_FACTOR }, `${name}-peer:${peer}`);
    await limit(rule, `${name}:${clientIp(req, trustProxy).slice(0, 64)}`);
  }

  // Emails are sent after the response, so its timing doesn't reveal whether an
  // account exists. Failures are logged (addresses masked), never shown.
  const pending = new Set();
  function deliver(to, message, { devNote, sentLog = '[auth] Email accepted by Resend' } = {}) {
    if (!emailConfigured) {
      log.info?.(`\n[First Job AI] ${devNote} (development only):\n${message.text}\n`);
      return;
    }
    const job = (async () => {
      if (!(await limits.take('mail-total', LIMITS.mailTotal)).ok) {
        log.error?.('[auth] Email not sent: the hourly email limit was reached.');
        return;
      }
      const emailId = await sendEmail(env, to, message);
      log.info?.(`${sentLog} (email id ${emailId}).`);
    })()
      .catch((err) => log.error?.(`[auth] Could not send an email: ${err.message}`))
      .finally(() => pending.delete(job));
    pending.add(job);
  }

  function resetLinkBase(req) {
    if (appUrl) return appUrl;
    if (production) return null;
    const origin = req.headers?.origin;
    return origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : 'http://localhost:5173';
  }

  // Same answer, in about the same time, whether or not the email has an account:
  // a new address gets a confirmation link, an existing one a "you already have an account" email.
  async function signupWithVerification(req, res, email, password) {
    const base = resetLinkBase(req);
    if (!emailConfigured && !devResetLinks) throw new HttpError(503, 'Sign-up needs email to be set up on this server. Contact the site owner.', 'signup_unavailable');
    if (!base) throw new HttpError(503, 'Sign-up needs APP_URL to be set on the server.', 'signup_unavailable');
    await limit(LIMITS.mailPerAddress, `mail:${email}`);
    const passwordHash = await hashPassword(password); // Also for existing accounts, so the timing matches.
    if (await q.userByEmail(email)) {
      deliver(email, existingAccountEmail(base), { devNote: `Sign-up attempt for the existing account ${email}` });
    } else {
      const token = newToken();
      if (Math.random() < 0.05) await q.purgeExpired(new Date().toISOString());
      await q.insertVerification(sha256(token), email, passwordHash, new Date(Date.now() + VERIFY_HOURS * HOUR).toISOString());
      deliver(email, verifyEmail(`${base}/verify-email?token=${token}`), {
        devNote: `Confirmation email for ${email}`,
        sentLog: '[auth] Confirmation email accepted by Resend',
      });
    }
    return send(res, 202, {
      ok: true,
      verify: true,
      message: devResetLinks
        ? 'Almost done: the confirmation link was printed in the terminal where the app is running (email is not set up in development).'
        : `Almost done: check your email for a link to finish creating your account (it works for ${VERIFY_HOURS} hours). Look in your spam folder too.`,
    });
  }

  const routes = {
    'GET /me': async (req, res) => send(res, 200, { user: await getUser(req), passwordReset: emailConfigured ? 'email' : devResetLinks ? 'console' : 'unavailable' }),

    'POST /signup': async (req, res) => {
      await limitIp('signupIp', req);
      const body = await readJson(req, 10000);
      const email = String(body.email || '').trim().toLowerCase();
      const emailError = validateEmail(email);
      if (emailError) throw new HttpError(400, emailError, 'invalid_email');
      const passwordError = validatePassword(body.password, email);
      if (passwordError) throw new HttpError(400, passwordError, 'weak_password');
      if (verifyEmails) return signupWithVerification(req, res, email, String(body.password));
      if (await q.userByEmail(email)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.', 'email_taken');
      const now = new Date().toISOString();
      const id = randomUUID();
      try {
        await q.insertUser(id, email, await hashPassword(String(body.password)), now, now);
      } catch (err) {
        // Two sign-ups for the same email at once: the database's unique rule decides.
        if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists. Sign in instead.', 'email_taken');
        throw err;
      }
      await startSession(req, res, id);
      await trustDevice(req, res, id);
      return send(res, 201, { user: publicUser(await q.userById(id)) });
    },

    // Opens the link from the confirmation email. The password chosen at sign-up
    // must be entered again, so someone who receives a link they didn't ask for
    // can't end up in an account a stranger knows the password of.
    'POST /verify': async (req, res) => {
      await limitIp('signinIp', req);
      const body = await readJson(req, 10000);
      const token = String(body.token || '');
      const invalid = () => new HttpError(400, 'This link is invalid or has expired. Sign up again to get a new one.', 'invalid_token');
      const row = token && token.length < 100 ? await q.verificationByToken(sha256(token)) : null;
      if (!row || row.expires_at <= new Date().toISOString()) throw invalid();
      if (!(await limits.take(`verify:${row.token_hash}`, LIMITS.verifyAttempts)).ok) throw invalid();
      if (!(await verifyPassword(String(body.password || '').slice(0, 200), row.password_hash))) {
        throw new HttpError(400, 'That isn’t the password you chose when you signed up.', 'invalid_credentials');
      }
      if (await q.userByEmail(row.email)) {
        await q.deleteVerifications(row.email);
        throw new HttpError(409, 'This email already has an account. Sign in instead.', 'email_taken');
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      try {
        await q.insertUser(id, row.email, row.password_hash, now, now);
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'This email already has an account. Sign in instead.', 'email_taken');
        throw err;
      }
      await q.deleteVerifications(row.email);
      await startSession(req, res, id);
      await trustDevice(req, res, id);
      log.info?.('[auth] Email confirmed: account created.');
      return send(res, 201, { user: publicUser(await q.userById(id)) });
    },

    'POST /signin': async (req, res) => {
      await limitIp('signinIp', req);
      const body = await readJson(req, 10000);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (validateEmail(email) || !password) throw new HttpError(400, 'Enter your email and password.', 'invalid_input');
      const user = await q.userByEmail(email);
      // Wrong guesses from unknown browsers share one count per account; a browser that
      // signed in before has its own, so guessing can't lock the owner out there.
      const device = await trustedDevice(req, user?.id);
      const bucket = device ? `login-device:${device}` : `login:${email}`;
      // Counted before checking (atomic, so parallel guesses can't slip through), given back on success.
      const r = await limits.take(bucket, LIMITS.loginFailures);
      if (!r.ok) {
        throw tooMany(r.retryAfter, 'Too many wrong passwords for this account. Wait a few minutes, or reset your password to get back in right away.');
      }
      const ok = await verifyPassword(password.slice(0, 200), user ? user.password_hash : await dummyHash);
      if (!user || !ok) throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');
      await limits.untake(bucket);
      await startSession(req, res, user.id);
      await trustDevice(req, res, user.id);
      return send(res, 200, { user: publicUser(user) });
    },

    'POST /signout': async (req, res) => {
      const token = sessionToken(req);
      if (token) await q.deleteSession(sha256(token));
      clearCookie(res);
      return send(res, 200, { ok: true });
    },

    'POST /forgot': async (req, res) => {
      log.info?.('[auth] Reset request received.');
      await limitIp('forgotIp', req);
      const body = await readJson(req, 10000);
      const email = String(body.email || '').trim().toLowerCase();
      if (validateEmail(email)) {
        log.info?.('[auth] Reset request rejected: invalid email address.');
        throw new HttpError(400, 'Enter a valid email address.', 'invalid_email');
      }
      const base = resetLinkBase(req);
      if (!emailConfigured && !devResetLinks) {
        throw new HttpError(501, 'Password reset by email isn’t set up on this server yet. Contact the site owner.', 'reset_unavailable');
      }
      if (!base) throw new HttpError(501, 'Password reset needs APP_URL to be set on the server.', 'reset_unavailable');
      await limit(LIMITS.mailPerAddress, `mail:${email}`);
      const user = await q.userByEmail(email);
      if (user) {
        const token = await createResetToken(db, user.id);
        if (emailConfigured) log.info?.('[auth] Account found: sending the reset email through Resend.');
        deliver(user.email, resetEmail(`${base}/reset-password?token=${token}`), {
          devNote: `Password reset email for ${user.email}, valid ${RESET_MINUTES} min`,
          sentLog: '[auth] Reset email accepted by Resend',
        });
      } else {
        // Only the server log says so (never the address); the visitor gets the same answer either way.
        log.info?.('[auth] Reset requested for an email with no account: nothing was sent.');
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
      await limitIp('signinIp', req);
      const body = await readJson(req, 10000);
      const token = String(body.token || '');
      const row = token && token.length < 100 ? await q.resetByToken(sha256(token)) : null;
      if (!row || row.used_at || row.expires_at <= new Date().toISOString()) {
        log.info?.(`[auth] Reset link rejected: ${!row ? 'unknown' : row.used_at ? 'already used' : 'expired'}.`);
        throw new HttpError(400, 'This reset link is invalid or has expired. Ask for a new one.', 'invalid_token');
      }
      const user = await q.userById(row.user_id);
      const passwordError = validatePassword(body.password, user?.email);
      if (passwordError) throw new HttpError(400, passwordError, 'weak_password');
      const now = new Date().toISOString();
      // Claim the token first: of two requests with the same link, only one gets here.
      if ((await q.useReset(now, row.token_hash)) !== 1) {
        log.info?.('[auth] Reset link rejected: already used.');
        throw new HttpError(400, 'This reset link is invalid or has expired. Ask for a new one.', 'invalid_token');
      }
      await q.setPassword(await hashPassword(String(body.password)), now, user.id);
      await q.deleteUserResets(user.id);
      await q.deleteUserSessions(user.id); // Sign out everywhere else.
      await q.deleteUserDevices(user.id);
      await limits.clear(`login:${user.email}`); // Owning the inbox unlocks sign-in right away.
      await startSession(req, res, user.id);
      await trustDevice(req, res, user.id);
      log.info?.('[auth] Reset link accepted: password updated and other sessions signed out.');
      return send(res, 200, { user: publicUser(user) });
    },

    'POST /change-password': async (req, res) => {
      const user = await requireUser(req);
      await limit(LIMITS.account, `change:${user.id}`);
      const body = await readJson(req, 10000);
      const row = await q.userById(user.id);
      if (!(await verifyPassword(String(body.currentPassword || '').slice(0, 200), row.password_hash))) {
        throw new HttpError(400, 'Your current password is incorrect.', 'invalid_credentials');
      }
      const passwordError = validatePassword(body.newPassword, row.email);
      if (passwordError) throw new HttpError(400, passwordError, 'weak_password');
      await q.setPassword(await hashPassword(String(body.newPassword)), new Date().toISOString(), user.id);
      await q.deleteOtherSessions(user.id, sha256(sessionToken(req)));
      // Other browsers lose their trusted status too; this one is trusted again.
      await q.deleteUserDevices(user.id);
      await trustDevice(req, res, user.id);
      return send(res, 200, { ok: true });
    },

    'POST /delete-account': async (req, res) => {
      const user = await requireUser(req);
      await limit(LIMITS.account, `delete:${user.id}`);
      const body = await readJson(req, 10000);
      const row = await q.userById(user.id);
      if (!(await verifyPassword(String(body.password || '').slice(0, 200), row.password_hash))) {
        throw new HttpError(400, 'Your password is incorrect.', 'invalid_credentials');
      }
      await beforeDeleteUser?.(user.id);
      await q.deleteUser(user.id); // Sessions, resets and saved data are deleted with it.
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
      if (err.code === 'rate_limited') {
        log.warn?.(`[auth] ${req.method} ${pathOf(req)} rate limited.`);
        return rateLimited(res, err.retryAfter, err.message);
      }
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      log.error?.(err);
      return send(res, 500, { error: 'Something went wrong on the server. Please try again.', code: 'server_error' });
    }
  }

  // settled(): resolves once emails started so far were handed to Resend (used by tests).
  return { handler, getUser, requireUser, settled: () => Promise.all([...pending]) };
}
