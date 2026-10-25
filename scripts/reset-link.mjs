// Prints a one-time password-reset link for an existing account, for when
// reset email (RESEND_API_KEY / EMAIL_FROM) can't reach you:
//   railway ssh                              (a shell inside the backend)
//   npm run reset-link -- you@example.com
//
// Only someone with shell access to the server can run it. Nothing about the
// account changes until the link is used: it works once, for 60 minutes, then
// the new password is set and every other session is signed out. The link is
// printed only to an interactive terminal (never into a file, pipe or log),
// and never by the server itself. Open it yourself; never share or paste it.
import { existsSync } from 'node:fs';
import { createResetToken } from '../server/auth.js';
import { describeTarget, isPostgresUrl, maskSecrets, openDatabase } from '../server/db.js';

if (existsSync('.env') && process.env.NODE_ENV !== 'production') process.loadEnvFile('.env');
const email = String(process.argv[2] || '').trim().toLowerCase();
const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
const target = String(process.env.DATABASE_URL || '').trim();

function stop(message) {
  console.error(`${message} Nothing was changed.`);
  process.exit(1);
}

if (!email) stop('Usage: npm run reset-link -- you@example.com');
if (!process.stdout.isTTY) stop('The link is only shown in an interactive terminal (so it never lands in a file or log). Run this in the railway ssh shell.');
if (!/^https?:\/\//.test(appUrl)) stop('APP_URL must be set to the public address of the site (e.g. https://first-job-ai-steel.vercel.app).');
// Same rule as db:check: without DATABASE_URL only an existing local dev database is used.
if (!isPostgresUrl(target) && (process.env.RAILWAY_PROJECT_ID || !existsSync('data/pglite'))) {
  stop('DATABASE_URL is not set here, so there is no database to use.');
}

const where = target || 'data/pglite';
let db;
try {
  db = await openDatabase(where, { migrate: false });
  const user = await db.one('SELECT id FROM users WHERE email = $1', [email]);
  if (!user) {
    console.error(`No account with that email in ${describeTarget(where)}. Nothing was changed.`);
    process.exitCode = 1;
  } else {
    const token = await createResetToken(db, user.id);
    console.log(`\nOpen this link in your browser within 60 minutes. It works once:\n\n${appUrl}/reset-password?token=${token}\n`);
  }
} catch (err) {
  console.error(`Could not create a reset link: ${maskSecrets(err.message, where)}`);
  process.exitCode = 1;
} finally {
  await db?.close();
}
