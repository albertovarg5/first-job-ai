// Prints a one-time password-reset link for an existing account, for when
// reset email (RESEND_API_KEY / EMAIL_FROM) isn't set up:
//   railway ssh                              (a shell inside the backend)
//   npm run reset-link -- you@example.com
//
// Only someone with shell access to the server can run it. Nothing about the
// account changes until the link is used: it works once, for 60 minutes, then
// the new password is set and every other session is signed out. The link is
// shown only in this terminal. Open it yourself; never share or paste it.
import { existsSync } from 'node:fs';
import { createResetToken } from '../server/auth.js';
import { describeTarget, openDatabase } from '../server/db.js';

if (existsSync('.env') && process.env.NODE_ENV !== 'production') process.loadEnvFile('.env');
const email = String(process.argv[2] || '').trim().toLowerCase();
const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
if (!email) {
  console.error('Usage: npm run reset-link -- you@example.com');
  process.exit(1);
}
if (!/^https?:\/\//.test(appUrl)) {
  console.error('APP_URL must be set to the public address of the site (e.g. https://first-job-ai-steel.vercel.app).');
  process.exit(1);
}

const target = process.env.DATABASE_URL || 'data/pglite';
const db = await openDatabase(target);
try {
  const user = await db.one('SELECT id FROM users WHERE email = $1', [email]);
  if (!user) {
    console.error(`No account with that email in ${describeTarget(target)}. Nothing was changed.`);
    process.exitCode = 1;
  } else {
    const token = await createResetToken(db, user.id);
    console.log(`\nOpen this link in your browser within 60 minutes. It works once:\n\n${appUrl}/reset-password?token=${token}\n`);
  }
} finally {
  await db.close();
}
